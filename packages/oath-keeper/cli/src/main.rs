use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{self, stdout};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use chrono::{DateTime, Local};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
    Terminal,
};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};

// ─── Data ────────────────────────────────────────────────────────

#[derive(Deserialize, Serialize, Debug, Clone)]
struct Oath {
    id: String,
    #[serde(rename = "conversationId")] conversation_id: String,
    promise: String,
    #[serde(default)] context: String,
    #[serde(rename = "createdAt")] created_at: i64,
    #[serde(rename = "dueAt")] due_at: i64,
    status: String,
    result: Option<String>,
    #[serde(rename = "deliveredAt")] delivered_at: Option<i64>,
    #[serde(default)] cron_id: Option<String>,
    #[serde(default, rename = "deliveryMode")] delivery_mode: Option<String>,
    #[serde(default, rename = "ngramScore")] ngram_score: Option<f64>,
}

#[derive(Deserialize, Serialize, Debug, Default)]
struct State { oaths: Vec<Oath> }

// ─── Helpers ─────────────────────────────────────────────────────

fn home() -> String { env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()) }
fn state_path() -> PathBuf { PathBuf::from(home()).join(".letta/mods/oath-keeper.state.json") }

fn load_state() -> State {
    fs::read_to_string(state_path()).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(state: &State) {
    let _ = fs::write(state_path(), serde_json::to_string_pretty(state).unwrap());
}

fn get_env() -> (String, String) {
    let env: serde_json::Value = fs::read_to_string(
        PathBuf::from(home()).join(".letta/extensions/oath-env.json")
    ).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let base = env.get("LETTA_BASE_URL").and_then(|v| v.as_str()).unwrap_or("http://localhost:8283").to_string();
    let key = env.get("LETTA_API_KEY").and_then(|v| v.as_str()).unwrap_or("").to_string();
    (base, key)
}

fn fmt_time(ms: i64) -> String {
    DateTime::from_timestamp(ms / 1000, 0)
        .map(|dt| dt.with_timezone(&Local).format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "?".to_string())
}

#[derive(Deserialize, Debug)]
struct DebugEntry {
    ts: i64,
    msg: String,
}

fn load_debug_log() -> Vec<DebugEntry> {
    let path = std::path::PathBuf::from(home()).join(".letta/mods/oath-keeper-debug.json");
    fs::read_to_string(path).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[derive(Deserialize, Debug)]
struct CronTask {
    id: String,
    name: String,
    #[serde(default)] status: String,
    #[serde(default, rename = "scheduled_for")] scheduled_for: String,
}

fn load_crons() -> Vec<CronTask> {
    let output = Command::new("letta").args(["cron", "list"]).output();
    match output {
        Ok(o) => String::from_utf8(o.stdout).ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .and_then(|v: serde_json::Value| {
                if v.is_array() { Some(v) }
                else { v.get("crons").cloned() }
            })
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn cron_countdown(crons: &[CronTask], cron_id: &str) -> Option<String> {
    let cron = crons.iter().find(|c| c.id == cron_id)?;
    if cron.status != "active" { return None; }
    // Parse scheduled_for (ISO 8601) and compute remaining
    let scheduled = chrono::DateTime::parse_from_rfc3339(&cron.scheduled_for).ok()?;
    let now = chrono::Utc::now();
    let diff = scheduled.signed_duration_since(now);
    let secs = diff.num_seconds();
    if secs <= 0 { return Some("due now".to_string()); }
    if secs < 60 { return Some(format!("{}s", secs)); }
    Some(format!("{}m", secs / 60))
}

fn fmt_ago(ms: i64) -> String {
    let now = Local::now().timestamp_millis();
    let diff = ((now - ms) / 1000).max(0);
    if diff < 60 { format!("{}s", diff) }
    else if diff < 3600 { format!("{}m", diff / 60) }
    else { format!("{}h", diff / 3600) }
}

fn deliver(oath: &Oath) -> String {
    let (base, key) = get_env();
    let prompt = format!(
        "[Oath Keeper] You previously promised the user:\n\"{}\"\n\n\
        Deliver on your promise now. Answer directly. \
        If you need to check something, use Bash — not web_search. \
        Keep it to 1-3 sentences. Start with \"[Oath Delivered]\".",
        oath.promise
    );
    let escaped = prompt.replace("'", "'\\''").replace("\"", "\\\"");
    let auth = if key.is_empty() { String::new() } else { format!("-H 'Authorization: Bearer {}'", key) };
    bash(&format!(
        "curl -s -X POST '{}/v1/conversations/{}/messages' \
        -H 'Content-Type: application/json' {} \
        -d '{{\"input\":\"{}\",\"role\":\"user\"}}' \
        --max-time 30 2>/dev/null | head -5",
        base, oath.conversation_id, auth, escaped
    ))
}

fn bash(cmd: &str) -> String {
    Command::new("bash").args(["-c", cmd]).output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default()
}

// ─── TUI ─────────────────────────────────────────────────────────

#[derive(PartialEq)]
#[derive(Deserialize, Debug)]
struct FalsePositive {
    ts: i64,
    pattern: String,
    source: String,
    #[serde(default)] text: String,
}

fn load_false_positives() -> Vec<FalsePositive> {
    let path = std::path::PathBuf::from(home()).join(".letta/mods/oath-keeper-false-positives.json");
    fs::read_to_string(path).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[derive(Clone, Copy, PartialEq)]
enum Mode { List, Detail }

fn run_tui(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    let mut list_state = ListState::default();
    list_state.select(Some(0));
    let mut mode = Mode::List;
    let mut status_msg = String::new();

    loop {
        let now_ms = Local::now().timestamp_millis();
        let state = load_state();
        let crons = load_crons();
        let count = state.oaths.len();

        // Keep selection in bounds, auto-select first when list populates
        if count == 0 { list_state.select(None); }
        else {
            match list_state.selected() {
                None => list_state.select(Some(0)),
                Some(sel) => { if sel >= count { list_state.select(Some(count - 1)); } }
            }
        }

        // Sort oaths newest first, map to sorted indices
        let mut sorted: Vec<&Oath> = state.oaths.iter().collect();
        sorted.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        terminal.draw(|f| {
            let area = f.area();
            let chunks = Layout::default()
                .constraints([Constraint::Length(2), Constraint::Min(1), Constraint::Length(3)])
                .split(area);

            // ── Header ──
            let pending = sorted.iter().filter(|o| o.status == "pending").count();
            let queued = sorted.iter().filter(|o| o.status == "queued").count();
            let delivering = sorted.iter().filter(|o| o.status == "delivering").count();
            let delivered = sorted.iter().filter(|o| o.status == "delivered").count();
            let failed = sorted.iter().filter(|o| o.status == "failed").count();
            let false_pos = sorted.iter().filter(|o| o.status == "false_positive").count();
            let prefiltered = sorted.iter().filter(|o| o.status == "prefilter_rejected").count();

            let mut hdr = vec![
                Span::styled(" Oath Keeper ", Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::raw(" "),
                Span::styled(fmt_time(now_ms), Style::default().fg(Color::Blue)),
            ];
            if pending > 0 { hdr.push(Span::styled(format!("  P:{}", pending), Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))); }
            if queued > 0 { hdr.push(Span::styled(format!("  Q:{}", queued), Style::default().fg(Color::Blue).add_modifier(Modifier::BOLD))); }
            if delivering > 0 { hdr.push(Span::styled(format!("  >:{}", delivering), Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))); }
            if delivered > 0 { hdr.push(Span::styled(format!("  OK:{}", delivered), Style::default().fg(Color::Green))); }
            if failed > 0 { hdr.push(Span::styled(format!("  X:{}", failed), Style::default().fg(Color::Red))); }
            if false_pos > 0 { hdr.push(Span::styled(format!("  FP:{}", false_pos), Style::default().fg(Color::DarkGray))); }
            if prefiltered > 0 { hdr.push(Span::styled(format!("  PF:{}", prefiltered), Style::default().fg(Color::Magenta))); }
            if count == 0 { hdr.push(Span::styled("  empty", Style::default().fg(Color::DarkGray))); }

            f.render_widget(Paragraph::new(Line::from(hdr)), chunks[0]);

            // ── Main content ──
            match mode {
                Mode::List => {
                    if count == 0 {
                        f.render_widget(
                            Paragraph::new(vec![
                                Line::from(""),
                                Line::from(Span::styled(
                                    "  No oaths. Agents have kept their word.",
                                    Style::default().fg(Color::DarkGray),
                                )),
                            ]),
                            chunks[1],
                        );
                    } else {
                        let items: Vec<ListItem> = sorted.iter().enumerate().map(|(idx, o)| {
                            let (status_label, status_color) = match o.status.as_str() {
                                "pending" => {
                                    let secs = ((o.due_at - now_ms) / 1000).max(0);
                                    ("PENDING".to_string(), Color::Yellow)
                                }
                                "queued" => ("QUEUED".to_string(), Color::Blue),
                                "delivering" => ("DELIVERING".to_string(), Color::Cyan),
                                "delivered" => ("DELIVERED".to_string(), Color::Green),
                                "failed" => ("FAILED".to_string(), Color::Red),
                                "false_positive" => ("FALSE POS".to_string(), Color::DarkGray),
                                "prefilter_rejected" => ("PREFILTER".to_string(), Color::Magenta),
                                _ => ("UNKNOWN".to_string(), Color::Gray),
                            };

                            let source = if o.id.contains("manual") { "manual" } else { "polled from letta mod" };
                            let age = fmt_ago(o.created_at);

                            // Line 1: status badge + promise
                            let line1 = Line::from(vec![
                                Span::styled(format!(" {} ", status_label), Style::default().fg(Color::Black).bg(status_color).add_modifier(Modifier::BOLD)),
                                Span::raw(" "),
                                Span::styled(&o.promise, Style::default().fg(Color::White)),
                                if let Some(score) = o.ngram_score {
                                    Span::styled(format!(" [{}]", score), Style::default().fg(Color::Yellow))
                                } else {
                                    Span::raw("")
                                },
                            ]);

                            // Line 2: timer/source/age/conv metadata
                            let mut line2_spans: Vec<Span> = vec![Span::raw("  ")];

                            // Show cron countdown if cron is active
                            let cron_info = o.cron_id.as_ref()
                                .and_then(|cid| cron_countdown(&crons, cid))
                                .unwrap_or_default();

                            if o.status == "pending" || o.status == "queued" {
                                let secs = ((o.due_at - now_ms) / 1000).max(0);
                                let timer_color = if secs <= 10 { Color::Red } else { Color::Yellow };
                                line2_spans.push(Span::styled("timer:", Style::default().fg(Color::Gray)));
                                line2_spans.push(Span::styled(format!("{}s  ", secs), Style::default().fg(timer_color).add_modifier(Modifier::BOLD)));
                                if !cron_info.is_empty() {
                                    line2_spans.push(Span::styled("cron:", Style::default().fg(Color::Gray)));
                                    line2_spans.push(Span::styled(format!("{}  ", cron_info), Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)));
                                }
                            } else if let Some(d) = o.delivered_at {
                                line2_spans.push(Span::styled("done:", Style::default().fg(Color::Gray)));
                                line2_spans.push(Span::styled(format!("{}  ", fmt_time(d)), Style::default().fg(Color::Green)));
                            }

                            line2_spans.push(Span::styled("src:", Style::default().fg(Color::Gray)));
                            line2_spans.push(Span::styled(format!("{}  ", source), Style::default().fg(Color::Magenta)));
                            line2_spans.push(Span::styled("age:", Style::default().fg(Color::Gray)));
                            line2_spans.push(Span::styled(format!("{}  ", age), Style::default().fg(Color::LightBlue)));
                            line2_spans.push(Span::styled("conv:", Style::default().fg(Color::Gray)));
                            line2_spans.push(Span::styled(&o.conversation_id[..o.conversation_id.len().min(20)], Style::default().fg(Color::Blue)));

                            let line2 = Line::from(line2_spans);

                            let mut lines = vec![line1, line2];

                            // Show result for completed oaths
                            if let Some(r) = &o.result {
                                if !r.is_empty() && o.status != "pending" {
                                    let rc = if o.status == "delivered" { Color::Green } else { Color::Red };
                                    lines.push(Line::from(vec![
                                        Span::raw("       "),
                                        Span::styled(format!("-> {}", r), Style::default().fg(rc)),
                                    ]));
                                }
                            }
                            lines.push(Line::from(""));

                            ListItem::new(lines)
                        }).collect();

                        let list = List::new(items)
                            .block(Block::default().borders(Borders::ALL).title(" Oaths "))
                            .highlight_style(Style::default())
                            .highlight_symbol(" > ");

                        f.render_stateful_widget(list, chunks[1], &mut list_state.clone());
                    }
                }
                Mode::Detail => {
                    if let Some(sel) = list_state.selected() {
                        if sel < sorted.len() {
                            let o = sorted[sel];
                            let (icon, color) = match o.status.as_str() {
                                "pending" => ("PENDING", Color::Yellow),
                                "queued" => ("QUEUED", Color::Blue),
                                "delivering" => ("DELIVERING", Color::Cyan),
                                "delivered" => ("DELIVERED", Color::Green),
                                "failed" => ("FAILED", Color::Red),
                                "false_positive" => ("FALSE POS", Color::DarkGray),
                                "prefilter_rejected" => ("PREFILTER", Color::Magenta),
                                _ => ("UNKNOWN", Color::Gray),
                            };

                            let secs_left = if o.status == "pending" {
                                ((o.due_at - now_ms) / 1000).max(0)
                            } else { 0 };

                            let mut info_lines = vec![
                                Line::from(vec![
                                    Span::styled(format!(" {} ", icon), Style::default().fg(Color::Black).bg(color).add_modifier(Modifier::BOLD)),
                                    Span::raw(" "),
                                    Span::styled(&o.id, Style::default().fg(Color::DarkGray)),
                                ]),
                                Line::from(""),
                                Line::from(vec![
                                    Span::styled("Promise:  ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    Span::styled(&o.promise, Style::default().fg(Color::White)),
                                ]),
                                Line::from(""),
                                Line::from(vec![
                                    Span::styled("Status:   ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    Span::styled(o.status.clone(), Style::default().fg(color)),
                                    if o.status == "pending" {
                                        Span::styled(format!(" ({}s remaining)", secs_left), Style::default().fg(Color::Yellow))
                                    } else {
                                        Span::raw("")
                                    },
                                ]),
                                Line::from({
                                    let mut spans = vec![
                                        Span::styled("Score:    ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    ];
                                    if let Some(score) = o.ngram_score {
                                        spans.push(Span::styled(format!("{:.1}", score), Style::default().fg(Color::Yellow)));
                                    } else {
                                        spans.push(Span::styled("N/A", Style::default().fg(Color::DarkGray)));
                                    }
                                    spans
                                }),
                                Line::from(vec![
                                    Span::styled("Source:   ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    Span::styled(if o.id.contains("manual") { "Manual (TUI create)".to_string() } else { "Mod poller (setInterval 15s)".to_string() }, Style::default().fg(Color::Magenta)),
                                ]),
                                Line::from(vec![
                                    Span::styled("Created:  ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    Span::styled(format!("{} ({})", fmt_time(o.created_at), fmt_ago(o.created_at)), Style::default().fg(Color::Blue)),
                                ]),
                                Line::from(vec![
                                    Span::styled("Due:      ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    Span::styled(fmt_time(o.due_at), Style::default().fg(Color::Blue)),
                                ]),
                                Line::from(vec![
                                    Span::styled("Context:  ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    Span::styled(&o.context, Style::default().fg(Color::DarkGray)),
                                ]),
                                Line::from(""),
                                Line::from(vec![
                                    Span::styled("Conversation: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                                    Span::styled(&o.conversation_id, Style::default().fg(Color::Blue)),
                                ]),
                                Line::from(""),
                                Line::from(Span::styled("Delivery:", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
                                Line::from(Span::styled(
                                    format!("  POST {}/v1/conversations/{}/messages", get_env().0, o.conversation_id),
                                    Style::default().fg(Color::Green),
                                )),
                                Line::from(Span::styled(
                                    "  Body: POST to conversation endpoint",
                                    Style::default().fg(Color::DarkGray),
                                )),
                                Line::from(""),
                                Line::from(Span::styled("Result:", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
                                Line::from(Span::styled(
                                    o.result.as_deref().unwrap_or("(none)"),
                                    Style::default().fg(if o.status == "delivered" { Color::Green } else { Color::Red }),
                                )),
                                Line::from(""),
                                Line::from(Span::styled("Debug Log (last 10):", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
                            ];

                            // Add recent debug log entries
                            let debug_entries = load_debug_log();
                            for entry in debug_entries.iter().rev().take(10) {
                                info_lines.push(Line::from(vec![
                                    Span::styled(format!("  {} ", fmt_time(entry.ts)), Style::default().fg(Color::DarkGray)),
                                    Span::styled(&entry.msg, Style::default().fg(Color::Yellow)),
                                ]));
                            }

                            f.render_widget(
                                Paragraph::new(info_lines)
                                    .block(Block::default().borders(Borders::ALL).title(" Oath Detail ")),
                                chunks[1],
                            );
                        }
                    }
                }
            }

            // ── Footer ──
            let footer_text = match mode {
                Mode::List => " q quit  j/k move  i info  d deliver  x cancel  p purge  c clear filtered  C clear completed",
                Mode::Detail => " Esc/i back to list  d deliver  x cancel",
            };
            let mut footer = vec![
                Line::from(Span::styled(footer_text, Style::default().fg(Color::DarkGray))),
            ];
            if !status_msg.is_empty() {
                footer.push(Line::from(Span::styled(&status_msg, Style::default().fg(Color::Green))));
            }
            f.render_widget(
                Paragraph::new(footer).block(Block::default().borders(Borders::TOP)),
                chunks[2],
            );
        })?;

        // ── Input ──
        if event::poll(Duration::from_millis(500))? {
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press { continue; }
                let sel = list_state.selected();

                match mode {
                    Mode::List => match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => return Ok(()),
                        KeyCode::Char('j') | KeyCode::Down => {
                            if let Some(s) = sel { if s + 1 < count { list_state.select(Some(s + 1)); } }
                        }
                        KeyCode::Char('k') | KeyCode::Up => {
                            if let Some(s) = sel { if s > 0 { list_state.select(Some(s - 1)); } }
                        }
                        KeyCode::Char('i') => { if count > 0 { mode = Mode::Detail; } }
                        KeyCode::Char('p') => {
                            save_state(&State::default());
                            list_state.select(Some(0));
                            status_msg = "Purged all oaths".to_string();
                        }
                        KeyCode::Char('c') => {
                            let mut st = load_state();
                            let before = st.oaths.len();
                            st.oaths.retain(|o| o.status != "prefilter_rejected" && o.status != "false_positive");
                            save_state(&st);
                            let removed = before - st.oaths.len();
                            status_msg = format!("Cleared {} filtered entries", removed);
                        }
                        KeyCode::Char('C') => {
                            let mut st = load_state();
                            let before = st.oaths.len();
                            st.oaths.retain(|o| {
                                o.status == "pending" || o.status == "queued" || o.status == "delivering"
                            });
                            save_state(&st);
                            let removed = before - st.oaths.len();
                            status_msg = format!("Cleared {} completed entries", removed);
                        }
                        KeyCode::Char('x') => {
                            if let Some(s) = sel {
                                let mut st = load_state();
                                let mut idx_map: Vec<usize> = (0..st.oaths.len()).collect();
                                idx_map.sort_by(|&a, &b| st.oaths[b].created_at.cmp(&st.oaths[a].created_at));
                                let real = idx_map[s];
                                if st.oaths[real].status == "pending" {
                                    st.oaths[real].status = "failed".into();
                                    st.oaths[real].result = Some("Cancelled".into());
                                    st.oaths[real].delivered_at = Some(now_ms);
                                    save_state(&st);
                                    status_msg = "Oath cancelled".to_string();
                                }
                            }
                        }
                        KeyCode::Char('d') => {
                            if let Some(s) = sel {
                                let mut st = load_state();
                                let mut idx_map: Vec<usize> = (0..st.oaths.len()).collect();
                                idx_map.sort_by(|&a, &b| st.oaths[b].created_at.cmp(&st.oaths[a].created_at));
                                let real = idx_map[s];
                                if st.oaths[real].status == "pending" {
                                    let oath = st.oaths[real].clone();
                                    st.oaths[real].status = "delivering".into();
                                    save_state(&st);
                                    status_msg = "Delivering...".to_string();
                                    let result = deliver(&oath);
                                    let mut st2 = load_state();
                                    if let Some(o) = st2.oaths.get_mut(real) {
                                        o.status = "delivered".into();
                                        o.result = Some(result);
                                        o.delivered_at = Some(Local::now().timestamp_millis());
                                    }
                                    save_state(&st2);
                                    status_msg = "Delivered".to_string();
                                }
                            }
                        }
                        _ => {}
                    }
                    Mode::Detail => match key.code {
                        KeyCode::Esc | KeyCode::Char('i') | KeyCode::Char('q') => { mode = Mode::List; }
                        KeyCode::Char('x') => {
                            if let Some(s) = sel {
                                let mut st = load_state();
                                let mut idx_map: Vec<usize> = (0..st.oaths.len()).collect();
                                idx_map.sort_by(|&a, &b| st.oaths[b].created_at.cmp(&st.oaths[a].created_at));
                                let real = idx_map[s];
                                if st.oaths[real].status == "pending" {
                                    st.oaths[real].status = "failed".into();
                                    st.oaths[real].result = Some("Cancelled".into());
                                    st.oaths[real].delivered_at = Some(now_ms);
                                    save_state(&st);
                                    status_msg = "Oath cancelled".to_string();
                                    mode = Mode::List;
                                }
                            }
                        }
                        KeyCode::Char('d') => {
                            if let Some(s) = sel {
                                let mut st = load_state();
                                let mut idx_map: Vec<usize> = (0..st.oaths.len()).collect();
                                idx_map.sort_by(|&a, &b| st.oaths[b].created_at.cmp(&st.oaths[a].created_at));
                                let real = idx_map[s];
                                if st.oaths[real].status == "pending" {
                                    let oath = st.oaths[real].clone();
                                    st.oaths[real].status = "delivering".into();
                                    save_state(&st);
                                    status_msg = "Delivering...".to_string();
                                    let result = deliver(&oath);
                                    let mut st2 = load_state();
                                    if let Some(o) = st2.oaths.get_mut(real) {
                                        o.status = "delivered".into();
                                        o.result = Some(result);
                                        o.delivered_at = Some(Local::now().timestamp_millis());
                                    }
                                    save_state(&st2);
                                    status_msg = "Delivered".to_string();
                                    mode = Mode::List;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

// ─── Plain output ────────────────────────────────────────────────

fn print_plain() {
    let st = load_state();
    let p = st.oaths.iter().filter(|o| o.status == "pending").count();
    let d = st.oaths.iter().filter(|o| o.status == "delivered").count();
    let f = st.oaths.iter().filter(|o| o.status == "failed").count();
    println!("\n  Oath Keeper | {} pending | {} ok | {} failed\n", p, d, f);
    if st.oaths.is_empty() { println!("  No oaths.\n"); return; }
    let mut s: Vec<&Oath> = st.oaths.iter().collect();
    s.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    for o in &s {
        println!("  [{}] \"{}\"", o.status, o.promise);
    }
    println!();
}

// ─── Main ────────────────────────────────────────────────────────

fn main() {
    let watch = env::args().any(|a| a == "--watch" || a == "-w");
    let purge = env::args().any(|a| a == "--purge" || a == "-p");

    if purge { save_state(&State::default()); println!("Purged."); return; }

    // TUI is default; --plain for text output
    if !watch && env::args().any(|a| a == "--plain") {
        print_plain();
        return;
    }

    enable_raw_mode().unwrap();
    execute!(stdout(), EnterAlternateScreen).unwrap();
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout())).unwrap();
    let result = run_tui(&mut terminal);
    disable_raw_mode().unwrap();
    execute!(terminal.backend_mut(), LeaveAlternateScreen).unwrap();
    result.unwrap();
}
