#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/cli-width/index.js
var require_cli_width = __commonJS({
  "node_modules/cli-width/index.js"(exports2, module2) {
    "use strict";
    module2.exports = cliWidth2;
    function normalizeOpts(options) {
      const defaultOpts = {
        defaultWidth: 0,
        output: process.stdout,
        tty: require("tty")
      };
      if (!options) {
        return defaultOpts;
      }
      Object.keys(defaultOpts).forEach(function(key) {
        if (!options[key]) {
          options[key] = defaultOpts[key];
        }
      });
      return options;
    }
    function cliWidth2(options) {
      const opts = normalizeOpts(options);
      if (opts.output.getWindowSize) {
        return opts.output.getWindowSize()[0] || opts.defaultWidth;
      }
      if (opts.tty.getWindowSize) {
        return opts.tty.getWindowSize()[1] || opts.defaultWidth;
      }
      if (opts.output.columns) {
        return opts.output.columns;
      }
      if (process.env.CLI_WIDTH) {
        const width = parseInt(process.env.CLI_WIDTH, 10);
        if (!isNaN(width) && width !== 0) {
          return width;
        }
      }
      return opts.defaultWidth;
    }
  }
});

// node_modules/mute-stream/lib/index.js
var require_lib = __commonJS({
  "node_modules/mute-stream/lib/index.js"(exports2, module2) {
    var Stream = require("stream");
    var MuteStream2 = class extends Stream {
      #isTTY = null;
      constructor(opts = {}) {
        super(opts);
        this.writable = this.readable = true;
        this.muted = false;
        this.on("pipe", this._onpipe);
        this.replace = opts.replace;
        this._prompt = opts.prompt || null;
        this._hadControl = false;
      }
      #destSrc(key, def) {
        if (this._dest) {
          return this._dest[key];
        }
        if (this._src) {
          return this._src[key];
        }
        return def;
      }
      #proxy(method, ...args) {
        if (typeof this._dest?.[method] === "function") {
          this._dest[method](...args);
        }
        if (typeof this._src?.[method] === "function") {
          this._src[method](...args);
        }
      }
      get isTTY() {
        if (this.#isTTY !== null) {
          return this.#isTTY;
        }
        return this.#destSrc("isTTY", false);
      }
      // basically just get replace the getter/setter with a regular value
      set isTTY(val) {
        this.#isTTY = val;
      }
      get rows() {
        return this.#destSrc("rows");
      }
      get columns() {
        return this.#destSrc("columns");
      }
      mute() {
        this.muted = true;
      }
      unmute() {
        this.muted = false;
      }
      _onpipe(src) {
        this._src = src;
      }
      pipe(dest, options) {
        this._dest = dest;
        return super.pipe(dest, options);
      }
      pause() {
        if (this._src) {
          return this._src.pause();
        }
      }
      resume() {
        if (this._src) {
          return this._src.resume();
        }
      }
      write(c) {
        if (this.muted) {
          if (!this.replace) {
            return true;
          }
          if (c.match(/^\u001b/)) {
            if (c.indexOf(this._prompt) === 0) {
              c = c.slice(this._prompt.length);
              c = c.replace(/./g, this.replace);
              c = this._prompt + c;
            }
            this._hadControl = true;
            return this.emit("data", c);
          } else {
            if (this._prompt && this._hadControl && c.indexOf(this._prompt) === 0) {
              this._hadControl = false;
              this.emit("data", this._prompt);
              c = c.slice(this._prompt.length);
            }
            c = c.toString().replace(/./g, this.replace);
          }
        }
        this.emit("data", c);
      }
      end(c) {
        if (this.muted) {
          if (c && this.replace) {
            c = c.toString().replace(/./g, this.replace);
          } else {
            c = null;
          }
        }
        if (c) {
          this.emit("data", c);
        }
        this.emit("end");
      }
      destroy(...args) {
        return this.#proxy("destroy", ...args);
      }
      destroySoon(...args) {
        return this.#proxy("destroySoon", ...args);
      }
      close(...args) {
        return this.#proxy("close", ...args);
      }
    };
    module2.exports = MuteStream2;
  }
});

// node_modules/@inquirer/core/dist/lib/key.js
var keybindings = ["emacs", "vim"];
var keybindingLookup = new Set(keybindings);
function isKeybinding(value) {
  return keybindingLookup.has(value);
}
function getDefaultKeybindings() {
  const env = process.env["INQUIRER_KEYBINDINGS"];
  if (!env)
    return [];
  return Array.from(new Set(env.toLowerCase().split(/[\s,]+/).filter(isKeybinding)));
}
var isUpKey = (key, keybindings2 = []) => (
  // The up key
  key.name === "up" || // Vim keybinding: hjkl keys map to left/down/up/right
  keybindings2.includes("vim") && key.name === "k" || // Emacs keybinding: Ctrl+P means "previous" in Emacs navigation conventions
  keybindings2.includes("emacs") && key.ctrl && key.name === "p"
);
var isDownKey = (key, keybindings2 = []) => (
  // The down key
  key.name === "down" || // Vim keybinding: hjkl keys map to left/down/up/right
  keybindings2.includes("vim") && key.name === "j" || // Emacs keybinding: Ctrl+N means "next" in Emacs navigation conventions
  keybindings2.includes("emacs") && key.ctrl && key.name === "n"
);
var isSpaceKey = (key) => key.name === "space";
var isBackspaceKey = (key) => key.name === "backspace";
var isTabKey = (key) => key.name === "tab";
var isNumberKey = (key) => "1234567890".includes(key.name);
var isEnterKey = (key) => key.name === "enter" || key.name === "return";

// node_modules/@inquirer/core/dist/lib/errors.js
var AbortPromptError = class extends Error {
  name = "AbortPromptError";
  message = "Prompt was aborted";
  constructor(options) {
    super();
    this.cause = options?.cause;
  }
};
var CancelPromptError = class extends Error {
  name = "CancelPromptError";
  message = "Prompt was canceled";
};
var ExitPromptError = class extends Error {
  name = "ExitPromptError";
};
var HookError = class extends Error {
  name = "HookError";
};
var ValidationError = class extends Error {
  name = "ValidationError";
};

// node_modules/@inquirer/core/dist/lib/use-state.js
var import_node_async_hooks2 = require("node:async_hooks");

// node_modules/@inquirer/core/dist/lib/hook-engine.js
var import_node_async_hooks = require("node:async_hooks");
var hookStorage = new import_node_async_hooks.AsyncLocalStorage();
function createStore(rl) {
  const store = {
    rl,
    hooks: [],
    hooksCleanup: [],
    hooksEffect: [],
    index: 0,
    handleChange() {
    }
  };
  return store;
}
function withHooks(rl, cb) {
  const store = createStore(rl);
  return hookStorage.run(store, () => {
    function cycle(render) {
      store.handleChange = () => {
        store.index = 0;
        render();
      };
      store.handleChange();
    }
    return cb(cycle);
  });
}
function getStore() {
  const store = hookStorage.getStore();
  if (!store) {
    throw new HookError("[Inquirer] Hook functions can only be called from within a prompt");
  }
  return store;
}
function readline() {
  return getStore().rl;
}
function withUpdates(fn) {
  const wrapped = (...args) => {
    const store = getStore();
    let shouldUpdate = false;
    const oldHandleChange = store.handleChange;
    store.handleChange = () => {
      shouldUpdate = true;
    };
    const returnValue = fn(...args);
    if (shouldUpdate) {
      oldHandleChange();
    }
    store.handleChange = oldHandleChange;
    return returnValue;
  };
  return import_node_async_hooks.AsyncResource.bind(wrapped);
}
function withPointer(cb) {
  const store = getStore();
  const { index } = store;
  const pointer = {
    get() {
      return store.hooks[index];
    },
    set(value) {
      store.hooks[index] = value;
    },
    initialized: index in store.hooks
  };
  const returnValue = cb(pointer);
  store.index++;
  return returnValue;
}
function handleChange() {
  getStore().handleChange();
}
var effectScheduler = {
  queue(cb) {
    const store = getStore();
    const { index } = store;
    store.hooksEffect.push(() => {
      store.hooksCleanup[index]?.();
      const cleanFn = cb(readline());
      if (cleanFn != null && typeof cleanFn !== "function") {
        throw new ValidationError("useEffect return value must be a cleanup function or nothing.");
      }
      store.hooksCleanup[index] = cleanFn;
    });
  },
  run() {
    const store = getStore();
    withUpdates(() => {
      store.hooksEffect.forEach((effect) => {
        effect();
      });
      store.hooksEffect.length = 0;
    })();
  },
  clearAll() {
    const store = getStore();
    store.hooksCleanup.forEach((cleanFn) => {
      cleanFn?.();
    });
    store.hooksEffect.length = 0;
    store.hooksCleanup.length = 0;
  }
};

// node_modules/@inquirer/core/dist/lib/use-state.js
function isFactory(value) {
  return typeof value === "function";
}
function useState(defaultValue) {
  return withPointer((pointer) => {
    const setState = import_node_async_hooks2.AsyncResource.bind(function setState2(newValue) {
      if (pointer.get() !== newValue) {
        pointer.set(newValue);
        handleChange();
      }
    });
    if (pointer.initialized) {
      return [pointer.get(), setState];
    }
    const value = isFactory(defaultValue) ? defaultValue() : defaultValue;
    pointer.set(value);
    return [value, setState];
  });
}

// node_modules/@inquirer/core/dist/lib/use-effect.js
function useEffect(cb, depArray) {
  withPointer((pointer) => {
    const oldDeps = pointer.get();
    const hasChanged = !Array.isArray(oldDeps) || depArray.some((dep, i) => !Object.is(dep, oldDeps[i]));
    if (hasChanged) {
      effectScheduler.queue(cb);
    }
    pointer.set(depArray);
  });
}

// node_modules/@inquirer/core/dist/lib/theme.js
var import_node_util = require("node:util");

// node_modules/@inquirer/figures/dist/index.js
var import_node_process = __toESM(require("node:process"), 1);
function isUnicodeSupported() {
  if (!import_node_process.default.platform.startsWith("win")) {
    return import_node_process.default.env["TERM"] !== "linux";
  }
  return Boolean(import_node_process.default.env["CI"]) || // CI environments generally support unicode
  Boolean(import_node_process.default.env["WT_SESSION"]) || // Windows Terminal
  Boolean(import_node_process.default.env["TERMINUS_SUBLIME"]) || // Terminus (<0.2.27)
  import_node_process.default.env["ConEmuTask"] === "{cmd::Cmder}" || // ConEmu and cmder
  import_node_process.default.env["TERM_PROGRAM"] === "Terminus-Sublime" || import_node_process.default.env["TERM_PROGRAM"] === "vscode" || import_node_process.default.env["TERM"] === "xterm-256color" || import_node_process.default.env["TERM"] === "alacritty" || import_node_process.default.env["TERMINAL_EMULATOR"] === "JetBrains-JediTerm";
}
var common = {
  circleQuestionMark: "(?)",
  questionMarkPrefix: "(?)",
  square: "\u2588",
  squareDarkShade: "\u2593",
  squareMediumShade: "\u2592",
  squareLightShade: "\u2591",
  squareTop: "\u2580",
  squareBottom: "\u2584",
  squareLeft: "\u258C",
  squareRight: "\u2590",
  squareCenter: "\u25A0",
  bullet: "\u25CF",
  dot: "\u2024",
  ellipsis: "\u2026",
  pointerSmall: "\u203A",
  triangleUp: "\u25B2",
  triangleUpSmall: "\u25B4",
  triangleDown: "\u25BC",
  triangleDownSmall: "\u25BE",
  triangleLeftSmall: "\u25C2",
  triangleRightSmall: "\u25B8",
  home: "\u2302",
  heart: "\u2665",
  musicNote: "\u266A",
  musicNoteBeamed: "\u266B",
  arrowUp: "\u2191",
  arrowDown: "\u2193",
  arrowLeft: "\u2190",
  arrowRight: "\u2192",
  arrowLeftRight: "\u2194",
  arrowUpDown: "\u2195",
  almostEqual: "\u2248",
  notEqual: "\u2260",
  lessOrEqual: "\u2264",
  greaterOrEqual: "\u2265",
  identical: "\u2261",
  infinity: "\u221E",
  subscriptZero: "\u2080",
  subscriptOne: "\u2081",
  subscriptTwo: "\u2082",
  subscriptThree: "\u2083",
  subscriptFour: "\u2084",
  subscriptFive: "\u2085",
  subscriptSix: "\u2086",
  subscriptSeven: "\u2087",
  subscriptEight: "\u2088",
  subscriptNine: "\u2089",
  oneHalf: "\xBD",
  oneThird: "\u2153",
  oneQuarter: "\xBC",
  oneFifth: "\u2155",
  oneSixth: "\u2159",
  oneEighth: "\u215B",
  twoThirds: "\u2154",
  twoFifths: "\u2156",
  threeQuarters: "\xBE",
  threeFifths: "\u2157",
  threeEighths: "\u215C",
  fourFifths: "\u2158",
  fiveSixths: "\u215A",
  fiveEighths: "\u215D",
  sevenEighths: "\u215E",
  line: "\u2500",
  lineBold: "\u2501",
  lineDouble: "\u2550",
  lineDashed0: "\u2504",
  lineDashed1: "\u2505",
  lineDashed2: "\u2508",
  lineDashed3: "\u2509",
  lineDashed4: "\u254C",
  lineDashed5: "\u254D",
  lineDashed6: "\u2574",
  lineDashed7: "\u2576",
  lineDashed8: "\u2578",
  lineDashed9: "\u257A",
  lineDashed10: "\u257C",
  lineDashed11: "\u257E",
  lineDashed12: "\u2212",
  lineDashed13: "\u2013",
  lineDashed14: "\u2010",
  lineDashed15: "\u2043",
  lineVertical: "\u2502",
  lineVerticalBold: "\u2503",
  lineVerticalDouble: "\u2551",
  lineVerticalDashed0: "\u2506",
  lineVerticalDashed1: "\u2507",
  lineVerticalDashed2: "\u250A",
  lineVerticalDashed3: "\u250B",
  lineVerticalDashed4: "\u254E",
  lineVerticalDashed5: "\u254F",
  lineVerticalDashed6: "\u2575",
  lineVerticalDashed7: "\u2577",
  lineVerticalDashed8: "\u2579",
  lineVerticalDashed9: "\u257B",
  lineVerticalDashed10: "\u257D",
  lineVerticalDashed11: "\u257F",
  lineDownLeft: "\u2510",
  lineDownLeftArc: "\u256E",
  lineDownBoldLeftBold: "\u2513",
  lineDownBoldLeft: "\u2512",
  lineDownLeftBold: "\u2511",
  lineDownDoubleLeftDouble: "\u2557",
  lineDownDoubleLeft: "\u2556",
  lineDownLeftDouble: "\u2555",
  lineDownRight: "\u250C",
  lineDownRightArc: "\u256D",
  lineDownBoldRightBold: "\u250F",
  lineDownBoldRight: "\u250E",
  lineDownRightBold: "\u250D",
  lineDownDoubleRightDouble: "\u2554",
  lineDownDoubleRight: "\u2553",
  lineDownRightDouble: "\u2552",
  lineUpLeft: "\u2518",
  lineUpLeftArc: "\u256F",
  lineUpBoldLeftBold: "\u251B",
  lineUpBoldLeft: "\u251A",
  lineUpLeftBold: "\u2519",
  lineUpDoubleLeftDouble: "\u255D",
  lineUpDoubleLeft: "\u255C",
  lineUpLeftDouble: "\u255B",
  lineUpRight: "\u2514",
  lineUpRightArc: "\u2570",
  lineUpBoldRightBold: "\u2517",
  lineUpBoldRight: "\u2516",
  lineUpRightBold: "\u2515",
  lineUpDoubleRightDouble: "\u255A",
  lineUpDoubleRight: "\u2559",
  lineUpRightDouble: "\u2558",
  lineUpDownLeft: "\u2524",
  lineUpBoldDownBoldLeftBold: "\u252B",
  lineUpBoldDownBoldLeft: "\u2528",
  lineUpDownLeftBold: "\u2525",
  lineUpBoldDownLeftBold: "\u2529",
  lineUpDownBoldLeftBold: "\u252A",
  lineUpDownBoldLeft: "\u2527",
  lineUpBoldDownLeft: "\u2526",
  lineUpDoubleDownDoubleLeftDouble: "\u2563",
  lineUpDoubleDownDoubleLeft: "\u2562",
  lineUpDownLeftDouble: "\u2561",
  lineUpDownRight: "\u251C",
  lineUpBoldDownBoldRightBold: "\u2523",
  lineUpBoldDownBoldRight: "\u2520",
  lineUpDownRightBold: "\u251D",
  lineUpBoldDownRightBold: "\u2521",
  lineUpDownBoldRightBold: "\u2522",
  lineUpDownBoldRight: "\u251F",
  lineUpBoldDownRight: "\u251E",
  lineUpDoubleDownDoubleRightDouble: "\u2560",
  lineUpDoubleDownDoubleRight: "\u255F",
  lineUpDownRightDouble: "\u255E",
  lineDownLeftRight: "\u252C",
  lineDownBoldLeftBoldRightBold: "\u2533",
  lineDownLeftBoldRightBold: "\u252F",
  lineDownBoldLeftRight: "\u2530",
  lineDownBoldLeftBoldRight: "\u2531",
  lineDownBoldLeftRightBold: "\u2532",
  lineDownLeftRightBold: "\u252E",
  lineDownLeftBoldRight: "\u252D",
  lineDownDoubleLeftDoubleRightDouble: "\u2566",
  lineDownDoubleLeftRight: "\u2565",
  lineDownLeftDoubleRightDouble: "\u2564",
  lineUpLeftRight: "\u2534",
  lineUpBoldLeftBoldRightBold: "\u253B",
  lineUpLeftBoldRightBold: "\u2537",
  lineUpBoldLeftRight: "\u2538",
  lineUpBoldLeftBoldRight: "\u2539",
  lineUpBoldLeftRightBold: "\u253A",
  lineUpLeftRightBold: "\u2536",
  lineUpLeftBoldRight: "\u2535",
  lineUpDoubleLeftDoubleRightDouble: "\u2569",
  lineUpDoubleLeftRight: "\u2568",
  lineUpLeftDoubleRightDouble: "\u2567",
  lineUpDownLeftRight: "\u253C",
  lineUpBoldDownBoldLeftBoldRightBold: "\u254B",
  lineUpDownBoldLeftBoldRightBold: "\u2548",
  lineUpBoldDownLeftBoldRightBold: "\u2547",
  lineUpBoldDownBoldLeftRightBold: "\u254A",
  lineUpBoldDownBoldLeftBoldRight: "\u2549",
  lineUpBoldDownLeftRight: "\u2540",
  lineUpDownBoldLeftRight: "\u2541",
  lineUpDownLeftBoldRight: "\u253D",
  lineUpDownLeftRightBold: "\u253E",
  lineUpBoldDownBoldLeftRight: "\u2542",
  lineUpDownLeftBoldRightBold: "\u253F",
  lineUpBoldDownLeftBoldRight: "\u2543",
  lineUpBoldDownLeftRightBold: "\u2544",
  lineUpDownBoldLeftBoldRight: "\u2545",
  lineUpDownBoldLeftRightBold: "\u2546",
  lineUpDoubleDownDoubleLeftDoubleRightDouble: "\u256C",
  lineUpDoubleDownDoubleLeftRight: "\u256B",
  lineUpDownLeftDoubleRightDouble: "\u256A",
  lineCross: "\u2573",
  lineBackslash: "\u2572",
  lineSlash: "\u2571"
};
var specialMainSymbols = {
  tick: "\u2714",
  info: "\u2139",
  warning: "\u26A0",
  cross: "\u2718",
  squareSmall: "\u25FB",
  squareSmallFilled: "\u25FC",
  circle: "\u25EF",
  circleFilled: "\u25C9",
  circleDotted: "\u25CC",
  circleDouble: "\u25CE",
  circleCircle: "\u24DE",
  circleCross: "\u24E7",
  circlePipe: "\u24BE",
  radioOn: "\u25C9",
  radioOff: "\u25EF",
  checkboxOn: "\u2612",
  checkboxOff: "\u2610",
  checkboxCircleOn: "\u24E7",
  checkboxCircleOff: "\u24BE",
  pointer: "\u276F",
  triangleUpOutline: "\u25B3",
  triangleLeft: "\u25C0",
  triangleRight: "\u25B6",
  lozenge: "\u25C6",
  lozengeOutline: "\u25C7",
  hamburger: "\u2630",
  smiley: "\u32E1",
  mustache: "\u0DF4",
  star: "\u2605",
  play: "\u25B6",
  nodejs: "\u2B22",
  oneSeventh: "\u2150",
  oneNinth: "\u2151",
  oneTenth: "\u2152"
};
var specialFallbackSymbols = {
  tick: "\u221A",
  info: "i",
  warning: "\u203C",
  cross: "\xD7",
  squareSmall: "\u25A1",
  squareSmallFilled: "\u25A0",
  circle: "( )",
  circleFilled: "(*)",
  circleDotted: "( )",
  circleDouble: "( )",
  circleCircle: "(\u25CB)",
  circleCross: "(\xD7)",
  circlePipe: "(\u2502)",
  radioOn: "(*)",
  radioOff: "( )",
  checkboxOn: "[\xD7]",
  checkboxOff: "[ ]",
  checkboxCircleOn: "(\xD7)",
  checkboxCircleOff: "( )",
  pointer: ">",
  triangleUpOutline: "\u2206",
  triangleLeft: "\u25C4",
  triangleRight: "\u25BA",
  lozenge: "\u2666",
  lozengeOutline: "\u25CA",
  hamburger: "\u2261",
  smiley: "\u263A",
  mustache: "\u250C\u2500\u2510",
  star: "\u2736",
  play: "\u25BA",
  nodejs: "\u2666",
  oneSeventh: "1/7",
  oneNinth: "1/9",
  oneTenth: "1/10"
};
var mainSymbols = {
  ...common,
  ...specialMainSymbols
};
var fallbackSymbols = {
  ...common,
  ...specialFallbackSymbols
};
var shouldUseMain = isUnicodeSupported();
var figures = shouldUseMain ? mainSymbols : fallbackSymbols;
var dist_default = figures;
var replacements = Object.entries(specialMainSymbols);

// node_modules/@inquirer/core/dist/lib/theme.js
var defaultTheme = {
  prefix: {
    idle: (0, import_node_util.styleText)("blue", "?"),
    done: (0, import_node_util.styleText)("green", dist_default.tick)
  },
  spinner: {
    interval: 80,
    frames: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"].map((frame) => (0, import_node_util.styleText)("yellow", frame))
  },
  keybindings: [],
  style: {
    answer: (text) => (0, import_node_util.styleText)("cyan", text),
    message: (text) => (0, import_node_util.styleText)("bold", text),
    error: (text) => (0, import_node_util.styleText)("red", `> ${text}`),
    defaultAnswer: (text) => (0, import_node_util.styleText)("dim", `(${text})`),
    help: (text) => (0, import_node_util.styleText)("dim", text),
    highlight: (text) => (0, import_node_util.styleText)("cyan", text),
    key: (text) => (0, import_node_util.styleText)("cyan", (0, import_node_util.styleText)("bold", `<${text}>`))
  }
};
function getDefaultTheme() {
  return {
    ...defaultTheme,
    keybindings: getDefaultKeybindings()
  };
}

// node_modules/@inquirer/core/dist/lib/make-theme.js
function isPlainObject(value) {
  if (typeof value !== "object" || value === null)
    return false;
  let proto = value;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(value) === proto;
}
function deepMerge(...objects) {
  const output = {};
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      const prevValue = output[key];
      output[key] = isPlainObject(prevValue) && isPlainObject(value) ? deepMerge(prevValue, value) : value;
    }
  }
  return output;
}
function makeTheme(...themes) {
  const themesToMerge = [
    getDefaultTheme(),
    ...themes.filter((theme) => theme != null)
  ];
  return deepMerge(...themesToMerge);
}

// node_modules/@inquirer/core/dist/lib/use-prefix.js
function usePrefix({ status = "idle", theme }) {
  const [showLoader, setShowLoader] = useState(false);
  const [tick, setTick] = useState(0);
  const { prefix, spinner } = makeTheme(theme);
  useEffect(() => {
    if (status === "loading") {
      let tickInterval;
      let inc = -1;
      const delayTimeout = setTimeout(() => {
        setShowLoader(true);
        tickInterval = setInterval(() => {
          inc = inc + 1;
          setTick(inc % spinner.frames.length);
        }, spinner.interval);
      }, 300);
      return () => {
        clearTimeout(delayTimeout);
        clearInterval(tickInterval);
      };
    } else {
      setShowLoader(false);
    }
  }, [status]);
  if (showLoader) {
    return spinner.frames[tick];
  }
  const iconName = status === "loading" ? "idle" : status;
  return typeof prefix === "string" ? prefix : prefix[iconName] ?? prefix["idle"];
}

// node_modules/@inquirer/core/dist/lib/use-memo.js
function useMemo(fn, dependencies) {
  return withPointer((pointer) => {
    const prev = pointer.get();
    if (!prev || prev.dependencies.length !== dependencies.length || prev.dependencies.some((dep, i) => dep !== dependencies[i])) {
      const value = fn();
      pointer.set({ value, dependencies });
      return value;
    }
    return prev.value;
  });
}

// node_modules/@inquirer/core/dist/lib/use-ref.js
function useRef(val) {
  return useState({ current: val })[0];
}

// node_modules/@inquirer/core/dist/lib/use-keypress.js
function useKeypress(userHandler) {
  const signal = useRef(userHandler);
  signal.current = userHandler;
  useEffect((rl) => {
    let ignore = false;
    const handler = withUpdates((_input, event) => {
      if (ignore)
        return;
      void signal.current(event, rl);
    });
    rl.input.on("keypress", handler);
    return () => {
      ignore = true;
      rl.input.removeListener("keypress", handler);
    };
  }, []);
}

// node_modules/@inquirer/core/dist/lib/utils.js
var import_cli_width = __toESM(require_cli_width(), 1);

// node_modules/fast-string-truncated-width/dist/utils.js
var getCodePointsLength = /* @__PURE__ */ (() => {
  const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
  return (input) => {
    let surrogatePairsNr = 0;
    SURROGATE_PAIR_RE.lastIndex = 0;
    while (SURROGATE_PAIR_RE.test(input)) {
      surrogatePairsNr += 1;
    }
    return input.length - surrogatePairsNr;
  };
})();
var isFullWidth = (x) => {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
};
var isWideNotCJKTNotEmoji = (x) => {
  return x === 8987 || x === 9001 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12771 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 19903 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
};

// node_modules/fast-string-truncated-width/dist/index.js
var ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y;
var CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
var CJKT_WIDE_RE = /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/yu;
var TAB_RE = /\t{1,1000}/y;
var EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F\u20E3?))*/yu;
var LATIN_RE = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
var MODIFIER_RE = /\p{M}+/gu;
var NO_TRUNCATION = { limit: Infinity, ellipsis: "" };
var getStringTruncatedWidth = (input, truncationOptions = {}, widthOptions = {}) => {
  const LIMIT = truncationOptions.limit ?? Infinity;
  const ELLIPSIS = truncationOptions.ellipsis ?? "";
  const ELLIPSIS_WIDTH = truncationOptions?.ellipsisWidth ?? (ELLIPSIS ? getStringTruncatedWidth(ELLIPSIS, NO_TRUNCATION, widthOptions).width : 0);
  const ANSI_WIDTH = 0;
  const CONTROL_WIDTH = widthOptions.controlWidth ?? 0;
  const TAB_WIDTH = widthOptions.tabWidth ?? 8;
  const EMOJI_WIDTH = widthOptions.emojiWidth ?? 2;
  const FULL_WIDTH_WIDTH = 2;
  const REGULAR_WIDTH = widthOptions.regularWidth ?? 1;
  const WIDE_WIDTH = widthOptions.wideWidth ?? FULL_WIDTH_WIDTH;
  const PARSE_BLOCKS = [
    [LATIN_RE, REGULAR_WIDTH],
    [ANSI_RE, ANSI_WIDTH],
    [CONTROL_RE, CONTROL_WIDTH],
    [TAB_RE, TAB_WIDTH],
    [EMOJI_RE, EMOJI_WIDTH],
    [CJKT_WIDE_RE, WIDE_WIDTH]
  ];
  let indexPrev = 0;
  let index = 0;
  let length = input.length;
  let lengthExtra = 0;
  let truncationEnabled = false;
  let truncationIndex = length;
  let truncationLimit = Math.max(0, LIMIT - ELLIPSIS_WIDTH);
  let unmatchedStart = 0;
  let unmatchedEnd = 0;
  let width = 0;
  let widthExtra = 0;
  outer: while (true) {
    if (unmatchedEnd > unmatchedStart || index >= length && index > indexPrev) {
      const unmatched = input.slice(unmatchedStart, unmatchedEnd) || input.slice(indexPrev, index);
      lengthExtra = 0;
      for (const char of unmatched.replaceAll(MODIFIER_RE, "")) {
        const codePoint = char.codePointAt(0) || 0;
        if (isFullWidth(codePoint)) {
          widthExtra = FULL_WIDTH_WIDTH;
        } else if (isWideNotCJKTNotEmoji(codePoint)) {
          widthExtra = WIDE_WIDTH;
        } else {
          widthExtra = REGULAR_WIDTH;
        }
        if (width + widthExtra > truncationLimit) {
          truncationIndex = Math.min(truncationIndex, Math.max(unmatchedStart, indexPrev) + lengthExtra);
        }
        if (width + widthExtra > LIMIT) {
          truncationEnabled = true;
          break outer;
        }
        lengthExtra += char.length;
        width += widthExtra;
      }
      unmatchedStart = unmatchedEnd = 0;
    }
    if (index >= length) {
      break outer;
    }
    for (let i = 0, l = PARSE_BLOCKS.length; i < l; i++) {
      const [BLOCK_RE, BLOCK_WIDTH] = PARSE_BLOCKS[i];
      BLOCK_RE.lastIndex = index;
      if (BLOCK_RE.test(input)) {
        lengthExtra = BLOCK_RE === CJKT_WIDE_RE ? getCodePointsLength(input.slice(index, BLOCK_RE.lastIndex)) : BLOCK_RE === EMOJI_RE ? 1 : BLOCK_RE.lastIndex - index;
        widthExtra = lengthExtra * BLOCK_WIDTH;
        if (width + widthExtra > truncationLimit) {
          truncationIndex = Math.min(truncationIndex, index + Math.floor((truncationLimit - width) / BLOCK_WIDTH));
        }
        if (width + widthExtra > LIMIT) {
          truncationEnabled = true;
          break outer;
        }
        width += widthExtra;
        unmatchedStart = indexPrev;
        unmatchedEnd = index;
        index = indexPrev = BLOCK_RE.lastIndex;
        continue outer;
      }
    }
    index += 1;
  }
  return {
    width: truncationEnabled ? truncationLimit : width,
    index: truncationEnabled ? truncationIndex : length,
    truncated: truncationEnabled,
    ellipsed: truncationEnabled && LIMIT >= ELLIPSIS_WIDTH
  };
};
var dist_default2 = getStringTruncatedWidth;

// node_modules/fast-string-width/dist/index.js
var NO_TRUNCATION2 = {
  limit: Infinity,
  ellipsis: "",
  ellipsisWidth: 0
};
var fastStringWidth = (input, options = {}) => {
  return dist_default2(input, NO_TRUNCATION2, options).width;
};
var dist_default3 = fastStringWidth;

// node_modules/fast-wrap-ansi/lib/main.js
var ESC = "\x1B";
var CSI = "\x9B";
var END_CODE = 39;
var ANSI_ESCAPE_BELL = "\x07";
var ANSI_CSI = "[";
var ANSI_OSC = "]";
var ANSI_SGR_TERMINATOR = "m";
var ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
var GROUP_REGEX = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`, "y");
var getClosingCode = (openingCode) => {
  if (openingCode >= 30 && openingCode <= 37)
    return 39;
  if (openingCode >= 90 && openingCode <= 97)
    return 39;
  if (openingCode >= 40 && openingCode <= 47)
    return 49;
  if (openingCode >= 100 && openingCode <= 107)
    return 49;
  if (openingCode === 1 || openingCode === 2)
    return 22;
  if (openingCode === 3)
    return 23;
  if (openingCode === 4)
    return 24;
  if (openingCode === 7)
    return 27;
  if (openingCode === 8)
    return 28;
  if (openingCode === 9)
    return 29;
  if (openingCode === 0)
    return 0;
  return void 0;
};
var wrapAnsiCode = (code) => `${ESC}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
var wrapAnsiHyperlink = (url) => `${ESC}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
var wrapWord = (rows, word, columns) => {
  const characters = word[Symbol.iterator]();
  let isInsideEscape = false;
  let isInsideLinkEscape = false;
  let lastRow = rows.at(-1);
  let visible = lastRow === void 0 ? 0 : dist_default3(lastRow);
  let currentCharacter = characters.next();
  let nextCharacter = characters.next();
  let rawCharacterIndex = 0;
  while (!currentCharacter.done) {
    const character = currentCharacter.value;
    const characterLength = dist_default3(character);
    if (visible + characterLength <= columns) {
      rows[rows.length - 1] += character;
    } else {
      rows.push(character);
      visible = 0;
    }
    if (character === ESC || character === CSI) {
      isInsideEscape = true;
      isInsideLinkEscape = word.startsWith(ANSI_ESCAPE_LINK, rawCharacterIndex + 1);
    }
    if (isInsideEscape) {
      if (isInsideLinkEscape) {
        if (character === ANSI_ESCAPE_BELL) {
          isInsideEscape = false;
          isInsideLinkEscape = false;
        }
      } else if (character === ANSI_SGR_TERMINATOR) {
        isInsideEscape = false;
      }
    } else {
      visible += characterLength;
      if (visible === columns && !nextCharacter.done) {
        rows.push("");
        visible = 0;
      }
    }
    currentCharacter = nextCharacter;
    nextCharacter = characters.next();
    rawCharacterIndex += character.length;
  }
  lastRow = rows.at(-1);
  if (!visible && lastRow !== void 0 && lastRow.length && rows.length > 1) {
    rows[rows.length - 2] += rows.pop();
  }
};
var stringVisibleTrimSpacesRight = (string) => {
  const words = string.split(" ");
  let last = words.length;
  while (last) {
    if (dist_default3(words[last - 1])) {
      break;
    }
    last--;
  }
  if (last === words.length) {
    return string;
  }
  return words.slice(0, last).join(" ") + words.slice(last).join("");
};
var exec = (string, columns, options = {}) => {
  if (options.trim !== false && string.trim() === "") {
    return "";
  }
  let returnValue = "";
  let escapeCode;
  let escapeUrl;
  const words = string.split(" ");
  let rows = [""];
  let rowLength = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (options.trim !== false) {
      const row = rows.at(-1) ?? "";
      const trimmed = row.trimStart();
      if (row.length !== trimmed.length) {
        rows[rows.length - 1] = trimmed;
        rowLength = dist_default3(trimmed);
      }
    }
    if (index !== 0) {
      if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
        rows.push("");
        rowLength = 0;
      }
      if (rowLength || options.trim === false) {
        rows[rows.length - 1] += " ";
        rowLength++;
      }
    }
    const wordLength = dist_default3(word);
    if (options.hard && wordLength > columns) {
      const remainingColumns = columns - rowLength;
      const breaksStartingThisLine = 1 + Math.floor((wordLength - remainingColumns - 1) / columns);
      const breaksStartingNextLine = Math.floor((wordLength - 1) / columns);
      if (breaksStartingNextLine < breaksStartingThisLine) {
        rows.push("");
      }
      wrapWord(rows, word, columns);
      rowLength = dist_default3(rows.at(-1) ?? "");
      continue;
    }
    if (rowLength + wordLength > columns && rowLength && wordLength) {
      if (options.wordWrap === false && rowLength < columns) {
        wrapWord(rows, word, columns);
        rowLength = dist_default3(rows.at(-1) ?? "");
        continue;
      }
      rows.push("");
      rowLength = 0;
    }
    if (rowLength + wordLength > columns && options.wordWrap === false) {
      wrapWord(rows, word, columns);
      rowLength = dist_default3(rows.at(-1) ?? "");
      continue;
    }
    rows[rows.length - 1] += word;
    rowLength += wordLength;
  }
  if (options.trim !== false) {
    rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
  }
  const preString = rows.join("\n");
  let inSurrogate = false;
  for (let i = 0; i < preString.length; i++) {
    const character = preString[i];
    returnValue += character;
    if (!inSurrogate) {
      inSurrogate = character >= "\uD800" && character <= "\uDBFF";
      if (inSurrogate) {
        continue;
      }
    } else {
      inSurrogate = false;
    }
    if (character === ESC || character === CSI) {
      GROUP_REGEX.lastIndex = i + 1;
      const groupsResult = GROUP_REGEX.exec(preString);
      const groups = groupsResult?.groups;
      if (groups?.code !== void 0) {
        const code = Number.parseFloat(groups.code);
        escapeCode = code === END_CODE ? void 0 : code;
      } else if (groups?.uri !== void 0) {
        escapeUrl = groups.uri.length === 0 ? void 0 : groups.uri;
      }
    }
    if (preString[i + 1] === "\n") {
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink("");
      }
      const closingCode = escapeCode ? getClosingCode(escapeCode) : void 0;
      if (escapeCode && closingCode) {
        returnValue += wrapAnsiCode(closingCode);
      }
    } else if (character === "\n") {
      if (escapeCode && getClosingCode(escapeCode)) {
        returnValue += wrapAnsiCode(escapeCode);
      }
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink(escapeUrl);
      }
    }
  }
  return returnValue;
};
var CRLF_OR_LF = /\r?\n/;
function wrapAnsi(string, columns, options) {
  return String(string).normalize().split(CRLF_OR_LF).map((line) => exec(line, columns, options)).join("\n");
}

// node_modules/@inquirer/core/dist/lib/utils.js
function breakLines(content, width) {
  return content.split("\n").flatMap((line) => wrapAnsi(line, width, { trim: false, wordWrap: false }).split("\n").map((str) => str.trimEnd())).join("\n");
}
function readlineWidth() {
  return (0, import_cli_width.default)({ defaultWidth: 80, output: readline().output });
}

// node_modules/@inquirer/core/dist/lib/pagination/use-pagination.js
function usePointerPosition({ active, renderedItems, pageSize, loop }) {
  const state = useRef({
    lastPointer: active,
    lastActive: void 0
  });
  const { lastPointer, lastActive } = state.current;
  const middle = Math.floor(pageSize / 2);
  const renderedLength = renderedItems.reduce((acc, item) => acc + item.length, 0);
  const defaultPointerPosition = renderedItems.slice(0, active).reduce((acc, item) => acc + item.length, 0);
  let pointer = defaultPointerPosition;
  if (renderedLength > pageSize) {
    if (loop) {
      pointer = lastPointer;
      if (
        // First render, skip this logic.
        lastActive != null && // Only move the pointer down when the user moves down.
        lastActive < active && // Check user didn't move up across page boundary.
        active - lastActive < pageSize
      ) {
        pointer = Math.min(
          // Furthest allowed position for the pointer is the middle of the list
          middle,
          Math.abs(active - lastActive) === 1 ? Math.min(
            // Move the pointer at most the height of the last active item.
            lastPointer + (renderedItems[lastActive]?.length ?? 0),
            // If the user moved by one item, move the pointer to the natural position of the active item as
            // long as it doesn't move the cursor up.
            Math.max(defaultPointerPosition, lastPointer)
          ) : (
            // Otherwise, move the pointer down by the difference between the active and last active item.
            lastPointer + active - lastActive
          )
        );
      }
    } else {
      const spaceUnderActive = renderedItems.slice(active).reduce((acc, item) => acc + item.length, 0);
      pointer = spaceUnderActive < pageSize - middle ? (
        // If the active item is near the end of the list, progressively move the cursor towards the end.
        pageSize - spaceUnderActive
      ) : (
        // Otherwise, progressively move the pointer to the middle of the list.
        Math.min(defaultPointerPosition, middle)
      );
    }
  }
  state.current.lastPointer = pointer;
  state.current.lastActive = active;
  return pointer;
}
function usePagination({ items, active, renderItem, pageSize, loop = true }) {
  const width = readlineWidth();
  const bound = (num) => (num % items.length + items.length) % items.length;
  const renderedItems = items.map((item, index) => {
    if (item == null)
      return [];
    return breakLines(renderItem({ item, index, isActive: index === active }), width).split("\n");
  });
  const renderedLength = renderedItems.reduce((acc, item) => acc + item.length, 0);
  const renderItemAtIndex = (index) => renderedItems[index] ?? [];
  const pointer = usePointerPosition({ active, renderedItems, pageSize, loop });
  const activeItem = renderItemAtIndex(active).slice(0, pageSize);
  const activeItemPosition = pointer + activeItem.length <= pageSize ? pointer : pageSize - activeItem.length;
  const pageBuffer = Array.from({ length: pageSize });
  pageBuffer.splice(activeItemPosition, activeItem.length, ...activeItem);
  const itemVisited = /* @__PURE__ */ new Set([active]);
  let bufferPointer = activeItemPosition + activeItem.length;
  let itemPointer = bound(active + 1);
  while (bufferPointer < pageSize && !itemVisited.has(itemPointer) && (loop && renderedLength > pageSize ? itemPointer !== active : itemPointer > active)) {
    const lines = renderItemAtIndex(itemPointer);
    const linesToAdd = lines.slice(0, pageSize - bufferPointer);
    pageBuffer.splice(bufferPointer, linesToAdd.length, ...linesToAdd);
    itemVisited.add(itemPointer);
    bufferPointer += linesToAdd.length;
    itemPointer = bound(itemPointer + 1);
  }
  bufferPointer = activeItemPosition - 1;
  itemPointer = bound(active - 1);
  while (bufferPointer >= 0 && !itemVisited.has(itemPointer) && (loop && renderedLength > pageSize ? itemPointer !== active : itemPointer < active)) {
    const lines = renderItemAtIndex(itemPointer);
    const linesToAdd = lines.slice(Math.max(0, lines.length - bufferPointer - 1));
    pageBuffer.splice(bufferPointer - linesToAdd.length + 1, linesToAdd.length, ...linesToAdd);
    itemVisited.add(itemPointer);
    bufferPointer -= linesToAdd.length;
    itemPointer = bound(itemPointer - 1);
  }
  return pageBuffer.filter((line) => typeof line === "string").join("\n");
}

// node_modules/@inquirer/core/dist/lib/create-prompt.js
var readline2 = __toESM(require("node:readline"), 1);
var import_node_async_hooks3 = require("node:async_hooks");
var import_mute_stream = __toESM(require_lib(), 1);

// node_modules/signal-exit/dist/mjs/signals.js
var signals = [];
signals.push("SIGHUP", "SIGINT", "SIGTERM");
if (process.platform !== "win32") {
  signals.push(
    "SIGALRM",
    "SIGABRT",
    "SIGVTALRM",
    "SIGXCPU",
    "SIGXFSZ",
    "SIGUSR2",
    "SIGTRAP",
    "SIGSYS",
    "SIGQUIT",
    "SIGIOT"
    // should detect profiler and enable/disable accordingly.
    // see #21
    // 'SIGPROF'
  );
}
if (process.platform === "linux") {
  signals.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
}

// node_modules/signal-exit/dist/mjs/index.js
var processOk = (process4) => !!process4 && typeof process4 === "object" && typeof process4.removeListener === "function" && typeof process4.emit === "function" && typeof process4.reallyExit === "function" && typeof process4.listeners === "function" && typeof process4.kill === "function" && typeof process4.pid === "number" && typeof process4.on === "function";
var kExitEmitter = /* @__PURE__ */ Symbol.for("signal-exit emitter");
var global = globalThis;
var ObjectDefineProperty = Object.defineProperty.bind(Object);
var Emitter = class {
  emitted = {
    afterExit: false,
    exit: false
  };
  listeners = {
    afterExit: [],
    exit: []
  };
  count = 0;
  id = Math.random();
  constructor() {
    if (global[kExitEmitter]) {
      return global[kExitEmitter];
    }
    ObjectDefineProperty(global, kExitEmitter, {
      value: this,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }
  on(ev, fn) {
    this.listeners[ev].push(fn);
  }
  removeListener(ev, fn) {
    const list = this.listeners[ev];
    const i = list.indexOf(fn);
    if (i === -1) {
      return;
    }
    if (i === 0 && list.length === 1) {
      list.length = 0;
    } else {
      list.splice(i, 1);
    }
  }
  emit(ev, code, signal) {
    if (this.emitted[ev]) {
      return false;
    }
    this.emitted[ev] = true;
    let ret = false;
    for (const fn of this.listeners[ev]) {
      ret = fn(code, signal) === true || ret;
    }
    if (ev === "exit") {
      ret = this.emit("afterExit", code, signal) || ret;
    }
    return ret;
  }
};
var SignalExitBase = class {
};
var signalExitWrap = (handler) => {
  return {
    onExit(cb, opts) {
      return handler.onExit(cb, opts);
    },
    load() {
      return handler.load();
    },
    unload() {
      return handler.unload();
    }
  };
};
var SignalExitFallback = class extends SignalExitBase {
  onExit() {
    return () => {
    };
  }
  load() {
  }
  unload() {
  }
};
var SignalExit = class extends SignalExitBase {
  // "SIGHUP" throws an `ENOSYS` error on Windows,
  // so use a supported signal instead
  /* c8 ignore start */
  #hupSig = process3.platform === "win32" ? "SIGINT" : "SIGHUP";
  /* c8 ignore stop */
  #emitter = new Emitter();
  #process;
  #originalProcessEmit;
  #originalProcessReallyExit;
  #sigListeners = {};
  #loaded = false;
  constructor(process4) {
    super();
    this.#process = process4;
    this.#sigListeners = {};
    for (const sig of signals) {
      this.#sigListeners[sig] = () => {
        const listeners = this.#process.listeners(sig);
        let { count } = this.#emitter;
        const p = process4;
        if (typeof p.__signal_exit_emitter__ === "object" && typeof p.__signal_exit_emitter__.count === "number") {
          count += p.__signal_exit_emitter__.count;
        }
        if (listeners.length === count) {
          this.unload();
          const ret = this.#emitter.emit("exit", null, sig);
          const s = sig === "SIGHUP" ? this.#hupSig : sig;
          if (!ret)
            process4.kill(process4.pid, s);
        }
      };
    }
    this.#originalProcessReallyExit = process4.reallyExit;
    this.#originalProcessEmit = process4.emit;
  }
  onExit(cb, opts) {
    if (!processOk(this.#process)) {
      return () => {
      };
    }
    if (this.#loaded === false) {
      this.load();
    }
    const ev = opts?.alwaysLast ? "afterExit" : "exit";
    this.#emitter.on(ev, cb);
    return () => {
      this.#emitter.removeListener(ev, cb);
      if (this.#emitter.listeners["exit"].length === 0 && this.#emitter.listeners["afterExit"].length === 0) {
        this.unload();
      }
    };
  }
  load() {
    if (this.#loaded) {
      return;
    }
    this.#loaded = true;
    this.#emitter.count += 1;
    for (const sig of signals) {
      try {
        const fn = this.#sigListeners[sig];
        if (fn)
          this.#process.on(sig, fn);
      } catch (_) {
      }
    }
    this.#process.emit = (ev, ...a) => {
      return this.#processEmit(ev, ...a);
    };
    this.#process.reallyExit = (code) => {
      return this.#processReallyExit(code);
    };
  }
  unload() {
    if (!this.#loaded) {
      return;
    }
    this.#loaded = false;
    signals.forEach((sig) => {
      const listener = this.#sigListeners[sig];
      if (!listener) {
        throw new Error("Listener not defined for signal: " + sig);
      }
      try {
        this.#process.removeListener(sig, listener);
      } catch (_) {
      }
    });
    this.#process.emit = this.#originalProcessEmit;
    this.#process.reallyExit = this.#originalProcessReallyExit;
    this.#emitter.count -= 1;
  }
  #processReallyExit(code) {
    if (!processOk(this.#process)) {
      return 0;
    }
    this.#process.exitCode = code || 0;
    this.#emitter.emit("exit", this.#process.exitCode, null);
    return this.#originalProcessReallyExit.call(this.#process, this.#process.exitCode);
  }
  #processEmit(ev, ...args) {
    const og = this.#originalProcessEmit;
    if (ev === "exit" && processOk(this.#process)) {
      if (typeof args[0] === "number") {
        this.#process.exitCode = args[0];
      }
      const ret = og.call(this.#process, ev, ...args);
      this.#emitter.emit("exit", this.#process.exitCode, null);
      return ret;
    } else {
      return og.call(this.#process, ev, ...args);
    }
  }
};
var process3 = globalThis.process;
var {
  /**
   * Called when the process is exiting, whether via signal, explicit
   * exit, or running out of stuff to do.
   *
   * If the global process object is not suitable for instrumentation,
   * then this will be a no-op.
   *
   * Returns a function that may be used to unload signal-exit.
   */
  onExit,
  /**
   * Load the listeners.  Likely you never need to call this, unless
   * doing a rather deep integration with signal-exit functionality.
   * Mostly exposed for the benefit of testing.
   *
   * @internal
   */
  load,
  /**
   * Unload the listeners.  Likely you never need to call this, unless
   * doing a rather deep integration with signal-exit functionality.
   * Mostly exposed for the benefit of testing.
   *
   * @internal
   */
  unload
} = signalExitWrap(processOk(process3) ? new SignalExit(process3) : new SignalExitFallback());

// node_modules/@inquirer/core/dist/lib/screen-manager.js
var import_node_util2 = require("node:util");

// node_modules/@inquirer/ansi/dist/index.js
var ESC2 = "\x1B[";
var cursorLeft = ESC2 + "G";
var cursorHide = ESC2 + "?25l";
var cursorShow = ESC2 + "?25h";
var cursorUp = (rows = 1) => rows > 0 ? `${ESC2}${rows}A` : "";
var cursorDown = (rows = 1) => rows > 0 ? `${ESC2}${rows}B` : "";
var cursorTo = (x, y) => {
  if (typeof y === "number" && !Number.isNaN(y)) {
    return `${ESC2}${y + 1};${x + 1}H`;
  }
  return `${ESC2}${x + 1}G`;
};
var eraseLine = ESC2 + "2K";
var eraseLines = (lines) => lines > 0 ? (eraseLine + cursorUp(1)).repeat(lines - 1) + eraseLine + cursorLeft : "";

// node_modules/@inquirer/core/dist/lib/screen-manager.js
var height = (content) => content.split("\n").length;
var lastLine = (content) => content.split("\n").pop() ?? "";
var ScreenManager = class {
  // These variables are keeping information to allow correct prompt re-rendering
  height = 0;
  extraLinesUnderPrompt = 0;
  cursorPos;
  rl;
  constructor(rl) {
    this.rl = rl;
    this.cursorPos = rl.getCursorPos();
  }
  write(content) {
    this.rl.output.unmute();
    this.rl.output.write(content);
    this.rl.output.mute();
  }
  render(content, bottomContent = "") {
    const promptLine = lastLine(content);
    const rawPromptLine = (0, import_node_util2.stripVTControlCharacters)(promptLine);
    let prompt = rawPromptLine;
    if (this.rl.line.length > 0) {
      prompt = prompt.slice(0, -this.rl.line.length);
    }
    this.rl.setPrompt(prompt);
    this.cursorPos = this.rl.getCursorPos();
    const width = readlineWidth();
    content = breakLines(content, width);
    bottomContent = breakLines(bottomContent, width);
    if (rawPromptLine.length % width === 0) {
      content += "\n";
    }
    let output = content + (bottomContent ? "\n" + bottomContent : "");
    const promptLineUpDiff = Math.floor(rawPromptLine.length / width) - this.cursorPos.rows;
    const bottomContentHeight = promptLineUpDiff + (bottomContent ? height(bottomContent) : 0);
    if (bottomContentHeight > 0)
      output += cursorUp(bottomContentHeight);
    output += cursorTo(this.cursorPos.cols);
    this.write(cursorDown(this.extraLinesUnderPrompt) + eraseLines(this.height) + output);
    this.extraLinesUnderPrompt = bottomContentHeight;
    this.height = height(output);
  }
  checkCursorPos() {
    const cursorPos = this.rl.getCursorPos();
    if (cursorPos.cols !== this.cursorPos.cols) {
      this.write(cursorTo(cursorPos.cols));
      this.cursorPos = cursorPos;
    }
  }
  done({ clearContent }) {
    this.rl.setPrompt("");
    let output = cursorDown(this.extraLinesUnderPrompt);
    output += clearContent ? eraseLines(this.height) : "\n";
    output += cursorLeft;
    output += cursorShow;
    this.write(output);
    this.rl.close();
  }
};

// node_modules/@inquirer/core/dist/lib/promise-polyfill.js
var PromisePolyfill = class extends Promise {
  // Available starting from Node 22
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
  static withResolver() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
};

// node_modules/@inquirer/core/dist/lib/create-prompt.js
var import_node_path = __toESM(require("node:path"), 1);
var nativeSetImmediate = globalThis.setImmediate;
function getCallSites() {
  const savedPrepareStackTrace = Error.prepareStackTrace;
  let result = [];
  try {
    Error.prepareStackTrace = (_, callSites) => {
      const callSitesWithoutCurrent = callSites.slice(1);
      result = callSitesWithoutCurrent;
      return callSitesWithoutCurrent;
    };
    new Error().stack;
  } catch {
    return result;
  }
  Error.prepareStackTrace = savedPrepareStackTrace;
  return result;
}
function createPrompt(view) {
  const callSites = getCallSites();
  const prompt = (config, context = {}) => {
    const { input = process.stdin, signal } = context;
    const cleanups = /* @__PURE__ */ new Set();
    const output = new import_mute_stream.default();
    output.pipe(context.output ?? process.stdout);
    const rl = readline2.createInterface({
      terminal: true,
      input,
      output
    });
    output.mute();
    const screen = new ScreenManager(rl);
    const { promise, resolve, reject } = PromisePolyfill.withResolver();
    const cancel = () => reject(new CancelPromptError());
    if (signal) {
      const abort = () => reject(new AbortPromptError({ cause: signal.reason }));
      if (signal.aborted) {
        abort();
        return Object.assign(promise, { cancel });
      }
      signal.addEventListener("abort", abort);
      cleanups.add(() => signal.removeEventListener("abort", abort));
    }
    cleanups.add(onExit((code, signal2) => {
      reject(new ExitPromptError(`User force closed the prompt with ${code} ${signal2}`));
    }));
    const sigint = () => reject(new ExitPromptError(`User force closed the prompt with SIGINT`));
    rl.on("SIGINT", sigint);
    cleanups.add(() => rl.removeListener("SIGINT", sigint));
    return withHooks(rl, (cycle) => {
      const hooksCleanup = import_node_async_hooks3.AsyncResource.bind(() => effectScheduler.clearAll());
      rl.on("close", hooksCleanup);
      cleanups.add(() => rl.removeListener("close", hooksCleanup));
      const startCycle = () => {
        const checkCursorPos = () => screen.checkCursorPos();
        rl.input.on("keypress", checkCursorPos);
        cleanups.add(() => rl.input.removeListener("keypress", checkCursorPos));
        let pendingDone = null;
        cycle(() => {
          let effectsSettled = false;
          try {
            const nextView = view(config, (value) => {
              if (effectsSettled) {
                resolve(value);
              } else {
                pendingDone = { value };
              }
            });
            if (nextView === void 0) {
              let callerFilename = callSites[1]?.getFileName();
              if (callerFilename && !callerFilename.startsWith("file://")) {
                callerFilename = import_node_path.default.resolve(callerFilename);
              }
              throw new Error(`Prompt functions must return a string.
    at ${callerFilename}`);
            }
            const [content, bottomContent] = typeof nextView === "string" ? [nextView] : nextView;
            screen.render(content, bottomContent);
            effectScheduler.run();
          } catch (error) {
            reject(error);
          }
          effectsSettled = true;
          if (pendingDone !== null) {
            const { value } = pendingDone;
            pendingDone = null;
            resolve(value);
          }
        });
      };
      if ("readableFlowing" in input) {
        nativeSetImmediate(startCycle);
      } else {
        startCycle();
      }
      return Object.assign(promise.then((answer) => {
        effectScheduler.clearAll();
        return answer;
      }, (error) => {
        effectScheduler.clearAll();
        throw error;
      }).finally(() => {
        cleanups.forEach((cleanup) => cleanup());
        screen.done({ clearContent: Boolean(context.clearPromptOnDone) });
        output.end();
      }).then(() => promise), { cancel });
    });
  };
  return prompt;
}

// node_modules/@inquirer/core/dist/lib/Separator.js
var import_node_util3 = require("node:util");
var Separator = class {
  separator = (0, import_node_util3.styleText)("dim", Array.from({ length: 15 }).join(dist_default.line));
  type = "separator";
  constructor(separator) {
    if (separator) {
      this.separator = separator;
    }
  }
  static isSeparator(choice) {
    return Boolean(choice && typeof choice === "object" && "type" in choice && choice.type === "separator");
  }
};

// node_modules/@inquirer/checkbox/dist/index.js
var import_node_util4 = require("node:util");
var checkboxTheme = {
  icon: {
    checked: (0, import_node_util4.styleText)("green", dist_default.circleFilled),
    unchecked: dist_default.circle,
    cursor: dist_default.pointer,
    disabledChecked: (0, import_node_util4.styleText)("green", dist_default.circleDouble),
    disabledUnchecked: "-"
  },
  style: {
    disabled: (text) => (0, import_node_util4.styleText)("dim", text),
    renderSelectedChoices: (selectedChoices) => selectedChoices.map((choice) => choice.short).join(", "),
    description: (text) => (0, import_node_util4.styleText)("cyan", text),
    keysHelpTip: (keys) => keys.map(([key, action]) => `${(0, import_node_util4.styleText)("bold", key)} ${(0, import_node_util4.styleText)("dim", action)}`).join((0, import_node_util4.styleText)("dim", " \u2022 "))
  },
  i18n: { disabledError: "This option is disabled and cannot be toggled." }
};
function isSelectable(item) {
  return !Separator.isSeparator(item) && !item.disabled;
}
function isNavigable(item) {
  return !Separator.isSeparator(item);
}
function isChecked(item) {
  return !Separator.isSeparator(item) && item.checked;
}
function toggle(item) {
  return isSelectable(item) ? { ...item, checked: !item.checked } : item;
}
function check(checked) {
  return function(item) {
    return isSelectable(item) ? { ...item, checked } : item;
  };
}
function normalizeChoices(choices) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice))
      return choice;
    if (typeof choice !== "object" || choice === null || !("value" in choice)) {
      const name2 = String(choice);
      return {
        value: choice,
        name: name2,
        short: name2,
        checkedName: name2,
        disabled: false,
        checked: false
      };
    }
    const name = choice.name ?? String(choice.value);
    const normalizedChoice = {
      value: choice.value,
      name,
      short: choice.short ?? name,
      checkedName: choice.checkedName ?? name,
      disabled: choice.disabled ?? false,
      checked: choice.checked ?? false
    };
    if (choice.description) {
      normalizedChoice.description = choice.description;
    }
    return normalizedChoice;
  });
}
var dist_default4 = createPrompt((config, done) => {
  const { pageSize = 7, loop = true, required, validate = () => true } = config;
  const shortcuts = { all: "a", invert: "i", ...config.shortcuts };
  const theme = makeTheme(checkboxTheme, config.theme);
  const { keybindings: keybindings2 } = theme;
  const [status, setStatus] = useState("idle");
  const prefix = usePrefix({ status, theme });
  const [items, setItems] = useState(normalizeChoices(config.choices));
  const bounds = useMemo(() => {
    const first = items.findIndex(isNavigable);
    const last = items.findLastIndex(isNavigable);
    if (first === -1) {
      throw new ValidationError("[checkbox prompt] No selectable choices. All choices are disabled.");
    }
    return { first, last };
  }, [items]);
  const [active, setActive] = useState(bounds.first);
  const [errorMsg, setError] = useState();
  useKeypress(async (key) => {
    if (isEnterKey(key)) {
      const selection = items.filter(isChecked);
      const isValid = await validate([...selection]);
      if (required && !selection.length) {
        setError("At least one choice must be selected");
      } else if (isValid === true) {
        setStatus("done");
        done(selection.map((choice) => choice.value));
      } else {
        setError(isValid || "You must select a valid value");
      }
    } else if (isUpKey(key, keybindings2) || isDownKey(key, keybindings2)) {
      if (errorMsg) {
        setError(void 0);
      }
      if (loop || isUpKey(key, keybindings2) && active !== bounds.first || isDownKey(key, keybindings2) && active !== bounds.last) {
        const offset = isUpKey(key, keybindings2) ? -1 : 1;
        let next = active;
        do {
          next = (next + offset + items.length) % items.length;
        } while (!isNavigable(items[next]));
        setActive(next);
      }
    } else if (isSpaceKey(key)) {
      const activeItem = items[active];
      if (activeItem && !Separator.isSeparator(activeItem)) {
        if (activeItem.disabled) {
          setError(theme.i18n.disabledError);
        } else {
          setError(void 0);
          setItems(items.map((choice, i) => i === active ? toggle(choice) : choice));
        }
      }
    } else if (key.name === shortcuts.all) {
      const selectAll = items.some((choice) => isSelectable(choice) && !choice.checked);
      setItems(items.map(check(selectAll)));
    } else if (key.name === shortcuts.invert) {
      setItems(items.map(toggle));
    } else if (isNumberKey(key)) {
      const selectedIndex = Number(key.name) - 1;
      let selectableIndex = -1;
      const position = items.findIndex((item) => {
        if (Separator.isSeparator(item))
          return false;
        selectableIndex++;
        return selectableIndex === selectedIndex;
      });
      const selectedItem = items[position];
      if (selectedItem && isSelectable(selectedItem)) {
        setActive(position);
        setItems(items.map((choice, i) => i === position ? toggle(choice) : choice));
      }
    }
  });
  const message = theme.style.message(config.message, status);
  let description;
  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive }) {
      if (Separator.isSeparator(item)) {
        return ` ${item.separator}`;
      }
      const cursor = isActive ? theme.icon.cursor : " ";
      if (item.disabled) {
        const disabledLabel = typeof item.disabled === "string" ? item.disabled : "(disabled)";
        const checkbox2 = item.checked ? theme.icon.disabledChecked : theme.icon.disabledUnchecked;
        return theme.style.disabled(`${cursor}${checkbox2} ${item.name} ${disabledLabel}`);
      }
      if (isActive) {
        description = item.description;
      }
      const checkbox = item.checked ? theme.icon.checked : theme.icon.unchecked;
      const name = item.checked ? item.checkedName : item.name;
      const color = isActive ? theme.style.highlight : (x) => x;
      return color(`${cursor}${checkbox} ${name}`);
    },
    pageSize,
    loop
  });
  if (status === "done") {
    const selection = items.filter(isChecked);
    const answer = theme.style.answer(theme.style.renderSelectedChoices(selection, items));
    return [prefix, message, answer].filter(Boolean).join(" ");
  }
  const keys = [
    ["\u2191\u2193", "navigate"],
    ["space", "select"]
  ];
  if (shortcuts.all)
    keys.push([shortcuts.all, "all"]);
  if (shortcuts.invert)
    keys.push([shortcuts.invert, "invert"]);
  keys.push(["\u23CE", "submit"]);
  const helpLine = theme.style.keysHelpTip(keys);
  const lines = [
    [prefix, message].filter(Boolean).join(" "),
    page,
    " ",
    description ? theme.style.description(description) : "",
    errorMsg ? theme.style.error(errorMsg) : "",
    helpLine
  ].filter(Boolean).join("\n").trimEnd();
  return `${lines}${cursorHide}`;
});

// node_modules/@inquirer/confirm/dist/index.js
function getBooleanValue(value, defaultValue) {
  let answer = defaultValue !== false;
  if (/^(y|yes)/i.test(value))
    answer = true;
  else if (/^(n|no)/i.test(value))
    answer = false;
  return answer;
}
function boolToString(value) {
  return value ? "Yes" : "No";
}
var dist_default5 = createPrompt((config, done) => {
  const { transformer = boolToString } = config;
  const [status, setStatus] = useState("idle");
  const [value, setValue] = useState("");
  const theme = makeTheme(config.theme);
  const prefix = usePrefix({ status, theme });
  useKeypress((key, rl) => {
    if (status !== "idle")
      return;
    if (isEnterKey(key)) {
      const answer = getBooleanValue(value, config.default);
      setValue(transformer(answer));
      setStatus("done");
      done(answer);
    } else if (isTabKey(key)) {
      const answer = boolToString(!getBooleanValue(value, config.default));
      rl.clearLine(0);
      rl.write(answer);
      setValue(answer);
    } else {
      setValue(rl.line);
    }
  });
  let formattedValue = value;
  let defaultValue = "";
  if (status === "done") {
    formattedValue = theme.style.answer(value);
  } else {
    defaultValue = ` ${theme.style.defaultAnswer(config.default === false ? "y/N" : "Y/n")}`;
  }
  const message = theme.style.message(config.message, status);
  return `${prefix} ${message}${defaultValue} ${formattedValue}`;
});

// node_modules/@inquirer/input/dist/index.js
var inputTheme = {
  validationFailureMode: "keep"
};
var dist_default6 = createPrompt((config, done) => {
  const { prefill = "tab" } = config;
  const theme = makeTheme(inputTheme, config.theme);
  const [status, setStatus] = useState("idle");
  const [defaultValue, setDefaultValue] = useState(String(config.default ?? ""));
  const [errorMsg, setError] = useState();
  const [value, setValue] = useState("");
  const prefix = usePrefix({ status, theme });
  async function validate(value2) {
    const { required, pattern, patternError = "Invalid input" } = config;
    if (required && !value2) {
      return "You must provide a value";
    }
    if (pattern && !pattern.test(value2)) {
      return patternError;
    }
    if (typeof config.validate === "function") {
      return await config.validate(value2) || "You must provide a valid value";
    }
    return true;
  }
  useKeypress(async (key, rl) => {
    if (status !== "idle") {
      return;
    }
    if (isEnterKey(key)) {
      const answer = value || defaultValue;
      setStatus("loading");
      const isValid = await validate(answer);
      if (isValid === true) {
        setValue(answer);
        setStatus("done");
        done(answer);
      } else {
        if (theme.validationFailureMode === "clear") {
          setValue("");
        } else {
          rl.write(value);
        }
        setError(isValid);
        setStatus("idle");
      }
    } else if (isBackspaceKey(key) && !value) {
      setDefaultValue("");
    } else if (isTabKey(key) && !value) {
      setDefaultValue("");
      rl.clearLine(0);
      rl.write(defaultValue);
      setValue(defaultValue);
    } else {
      setValue(rl.line);
      setError(void 0);
    }
  });
  useEffect((rl) => {
    if (prefill === "editable" && defaultValue) {
      rl.write(defaultValue);
      setValue(defaultValue);
    }
  }, []);
  const message = theme.style.message(config.message, status);
  let formattedValue = value;
  if (typeof config.transformer === "function") {
    formattedValue = config.transformer(value, { isFinal: status === "done" });
  } else if (status === "done") {
    formattedValue = theme.style.answer(value);
  }
  let defaultStr;
  if (defaultValue && status !== "done" && !value) {
    defaultStr = theme.style.defaultAnswer(defaultValue);
  }
  let error = "";
  if (errorMsg) {
    error = theme.style.error(errorMsg);
  }
  return [
    [prefix, message, defaultStr, formattedValue].filter((v) => v !== void 0).join(" "),
    error
  ];
});

// node_modules/@inquirer/number/dist/index.js
function isStepOf(value, step, min) {
  const valuePow = value * Math.pow(10, 6);
  const stepPow = step * Math.pow(10, 6);
  const minPow = min * Math.pow(10, 6);
  return (valuePow - (Number.isFinite(min) ? minPow : 0)) % stepPow === 0;
}
function validateNumber(value, { min, max, step }) {
  if (value == null || Number.isNaN(value)) {
    return false;
  } else if (value < min || value > max) {
    return `Value must be between ${min} and ${max}`;
  } else if (step !== "any" && !isStepOf(value, step, min)) {
    return `Value must be a multiple of ${step}${Number.isFinite(min) ? ` starting from ${min}` : ""}`;
  }
  return true;
}
var dist_default7 = createPrompt((config, done) => {
  const { validate = () => true, min = -Infinity, max = Infinity, step = 1, required = false } = config;
  const theme = makeTheme(config.theme);
  const [status, setStatus] = useState("idle");
  const [value, setValue] = useState("");
  const validDefault = validateNumber(config.default, { min, max, step }) === true ? config.default?.toString() : void 0;
  const [defaultValue = "", setDefaultValue] = useState(validDefault);
  const [errorMsg, setError] = useState();
  const prefix = usePrefix({ status, theme });
  useKeypress(async (key, rl) => {
    if (status !== "idle") {
      return;
    }
    if (isEnterKey(key)) {
      const input = value || defaultValue;
      const answer = input === "" ? void 0 : Number(input);
      setStatus("loading");
      let isValid = true;
      if (required || answer != null) {
        isValid = validateNumber(answer, { min, max, step });
      }
      if (isValid === true && answer != null) {
        isValid = await validate(answer);
      }
      if (isValid === true) {
        setValue(String(answer ?? ""));
        setStatus("done");
        done(answer);
      } else {
        rl.write(value);
        setError(isValid || "You must provide a valid numeric value");
        setStatus("idle");
      }
    } else if (isBackspaceKey(key) && !value) {
      setDefaultValue(void 0);
    } else if (isTabKey(key) && !value) {
      setDefaultValue(void 0);
      rl.clearLine(0);
      rl.write(defaultValue);
      setValue(defaultValue);
    } else {
      setValue(rl.line);
      setError(void 0);
    }
  });
  const message = theme.style.message(config.message, status);
  let formattedValue = value;
  if (status === "done") {
    formattedValue = theme.style.answer(value);
  }
  let defaultStr;
  if (defaultValue && status !== "done" && !value) {
    defaultStr = theme.style.defaultAnswer(defaultValue);
  }
  let error = "";
  if (errorMsg) {
    error = theme.style.error(errorMsg);
  }
  return [
    [prefix, message, defaultStr, formattedValue].filter((v) => v !== void 0).join(" "),
    error
  ];
});

// node_modules/@inquirer/search/dist/index.js
var import_node_util5 = require("node:util");
var searchTheme = {
  icon: { cursor: dist_default.pointer },
  style: {
    disabled: (text) => (0, import_node_util5.styleText)("dim", `- ${text}`),
    searchTerm: (text) => (0, import_node_util5.styleText)("cyan", text),
    description: (text) => (0, import_node_util5.styleText)("cyan", text),
    keysHelpTip: (keys) => keys.map(([key, action]) => `${(0, import_node_util5.styleText)("bold", key)} ${(0, import_node_util5.styleText)("dim", action)}`).join((0, import_node_util5.styleText)("dim", " \u2022 "))
  }
};
function isSelectable2(item) {
  return !Separator.isSeparator(item) && !item.disabled;
}
function normalizeChoices2(choices) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice))
      return choice;
    if (typeof choice !== "object" || choice === null || !("value" in choice)) {
      const name2 = String(choice);
      return {
        value: choice,
        name: name2,
        short: name2,
        disabled: false
      };
    }
    const name = choice.name ?? String(choice.value);
    const normalizedChoice = {
      value: choice.value,
      name,
      short: choice.short ?? name,
      disabled: choice.disabled ?? false
    };
    if (choice.description) {
      normalizedChoice.description = choice.description;
    }
    return normalizedChoice;
  });
}
var dist_default8 = createPrompt((config, done) => {
  const { pageSize = 7, validate = () => true } = config;
  const theme = makeTheme(searchTheme, config.theme);
  const [status, setStatus] = useState("loading");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState();
  const defaultApplied = useRef(false);
  const prefix = usePrefix({ status, theme });
  const bounds = useMemo(() => {
    const first = searchResults.findIndex(isSelectable2);
    const last = searchResults.findLastIndex(isSelectable2);
    return { first, last };
  }, [searchResults]);
  const [active = bounds.first, setActive] = useState();
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setSearchError(void 0);
    const fetchResults = async () => {
      try {
        const results = await config.source(searchTerm || void 0, {
          signal: controller.signal
        });
        if (!controller.signal.aborted) {
          const normalized = normalizeChoices2(results);
          let initialActive;
          if (!defaultApplied.current && "default" in config) {
            const defaultIndex = normalized.findIndex((item) => isSelectable2(item) && item.value === config.default);
            initialActive = defaultIndex === -1 ? void 0 : defaultIndex;
            defaultApplied.current = true;
          }
          setActive(initialActive);
          setSearchError(void 0);
          setSearchResults(normalized);
          setStatus("idle");
        }
      } catch (error2) {
        if (!controller.signal.aborted && error2 instanceof Error) {
          setSearchError(error2.message);
        }
      }
    };
    void fetchResults();
    return () => {
      controller.abort();
    };
  }, [searchTerm]);
  const selectedChoice = searchResults[active];
  useKeypress(async (key, rl) => {
    if (isEnterKey(key)) {
      if (selectedChoice) {
        setStatus("loading");
        const isValid = await validate(selectedChoice.value);
        setStatus("idle");
        if (isValid === true) {
          setStatus("done");
          done(selectedChoice.value);
        } else if (selectedChoice.name === searchTerm) {
          setSearchError(isValid || "You must provide a valid value");
        } else {
          rl.write(selectedChoice.name);
          setSearchTerm(selectedChoice.name);
        }
      } else {
        rl.write(searchTerm);
      }
    } else if (isTabKey(key) && selectedChoice) {
      rl.clearLine(0);
      rl.write(selectedChoice.name);
      setSearchTerm(selectedChoice.name);
    } else if (status !== "loading" && (isUpKey(key) || isDownKey(key))) {
      rl.clearLine(0);
      if (isUpKey(key) && active !== bounds.first || isDownKey(key) && active !== bounds.last) {
        const offset = isUpKey(key) ? -1 : 1;
        let next = active;
        do {
          next = (next + offset + searchResults.length) % searchResults.length;
        } while (!isSelectable2(searchResults[next]));
        setActive(next);
      }
    } else {
      setSearchTerm(rl.line);
    }
  });
  const message = theme.style.message(config.message, status);
  const helpLine = theme.style.keysHelpTip([
    ["\u2191\u2193", "navigate"],
    ["\u23CE", "select"]
  ]);
  const page = usePagination({
    items: searchResults,
    active,
    renderItem({ item, isActive }) {
      if (Separator.isSeparator(item)) {
        return ` ${item.separator}`;
      }
      if (item.disabled) {
        const disabledLabel = typeof item.disabled === "string" ? item.disabled : "(disabled)";
        return theme.style.disabled(`${item.name} ${disabledLabel}`);
      }
      const color = isActive ? theme.style.highlight : (x) => x;
      const cursor = isActive ? theme.icon.cursor : ` `;
      return color(`${cursor} ${item.name}`);
    },
    pageSize,
    loop: false
  });
  let error;
  if (searchError) {
    error = theme.style.error(searchError);
  } else if (searchResults.length === 0 && searchTerm !== "" && status === "idle") {
    error = theme.style.error("No results found");
  }
  let searchStr;
  if (status === "done" && selectedChoice) {
    return [prefix, message, theme.style.answer(selectedChoice.short)].filter(Boolean).join(" ").trimEnd();
  } else {
    searchStr = theme.style.searchTerm(searchTerm);
  }
  const description = selectedChoice?.description;
  const header = [prefix, message, searchStr].filter(Boolean).join(" ").trimEnd();
  const body = [
    error ?? page,
    " ",
    description ? theme.style.description(description) : "",
    helpLine
  ].filter(Boolean).join("\n").trimEnd();
  return [header, body];
});

// node_modules/@inquirer/select/dist/index.js
var import_node_util6 = require("node:util");
var selectTheme = {
  icon: { cursor: dist_default.pointer },
  style: {
    disabled: (text) => (0, import_node_util6.styleText)("dim", text),
    description: (text) => (0, import_node_util6.styleText)("cyan", text),
    keysHelpTip: (keys) => keys.map(([key, action]) => `${(0, import_node_util6.styleText)("bold", key)} ${(0, import_node_util6.styleText)("dim", action)}`).join((0, import_node_util6.styleText)("dim", " \u2022 "))
  },
  i18n: { disabledError: "This option is disabled and cannot be selected." },
  indexMode: "hidden"
};
function isSelectable3(item) {
  return !Separator.isSeparator(item) && !item.disabled;
}
function isNavigable2(item) {
  return !Separator.isSeparator(item);
}
function normalizeChoices3(choices) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice))
      return choice;
    if (typeof choice !== "object" || choice === null || !("value" in choice)) {
      const name2 = String(choice);
      return {
        value: choice,
        name: name2,
        short: name2,
        disabled: false
      };
    }
    const name = choice.name ?? String(choice.value);
    const normalizedChoice = {
      value: choice.value,
      name,
      short: choice.short ?? name,
      disabled: choice.disabled ?? false
    };
    if (choice.description) {
      normalizedChoice.description = choice.description;
    }
    return normalizedChoice;
  });
}
var dist_default9 = createPrompt((config, done) => {
  const { loop = true, pageSize = 7 } = config;
  const theme = makeTheme(selectTheme, config.theme);
  const { keybindings: keybindings2 } = theme;
  const [status, setStatus] = useState("idle");
  const prefix = usePrefix({ status, theme });
  const searchTimeoutRef = useRef();
  const searchEnabled = !keybindings2.includes("vim");
  const items = useMemo(() => normalizeChoices3(config.choices), [config.choices]);
  const bounds = useMemo(() => {
    const first = items.findIndex(isNavigable2);
    const last = items.findLastIndex(isNavigable2);
    if (first === -1) {
      throw new ValidationError("[select prompt] No selectable choices. All choices are disabled.");
    }
    return { first, last };
  }, [items]);
  const defaultItemIndex = useMemo(() => {
    if (!("default" in config))
      return -1;
    return items.findIndex((item) => isSelectable3(item) && item.value === config.default);
  }, [config.default, items]);
  const [active, setActive] = useState(defaultItemIndex === -1 ? bounds.first : defaultItemIndex);
  const selectedChoice = items[active];
  if (selectedChoice == null || Separator.isSeparator(selectedChoice)) {
    throw new Error("Active index does not point to a choice");
  }
  const [errorMsg, setError] = useState();
  useKeypress((key, rl) => {
    clearTimeout(searchTimeoutRef.current);
    if (errorMsg) {
      setError(void 0);
    }
    if (isEnterKey(key)) {
      if (selectedChoice.disabled) {
        setError(theme.i18n.disabledError);
      } else {
        setStatus("done");
        done(selectedChoice.value);
      }
    } else if (isUpKey(key, keybindings2) || isDownKey(key, keybindings2)) {
      rl.clearLine(0);
      if (loop || isUpKey(key, keybindings2) && active !== bounds.first || isDownKey(key, keybindings2) && active !== bounds.last) {
        const offset = isUpKey(key, keybindings2) ? -1 : 1;
        let next = active;
        do {
          next = (next + offset + items.length) % items.length;
        } while (!isNavigable2(items[next]));
        setActive(next);
      }
    } else if (isNumberKey(key) && !Number.isNaN(Number(rl.line))) {
      const selectedIndex = Number(rl.line) - 1;
      let selectableIndex = -1;
      const position = items.findIndex((item2) => {
        if (Separator.isSeparator(item2))
          return false;
        selectableIndex++;
        return selectableIndex === selectedIndex;
      });
      const item = items[position];
      if (item != null && isSelectable3(item)) {
        setActive(position);
      }
      searchTimeoutRef.current = setTimeout(() => {
        rl.clearLine(0);
      }, 700);
    } else if (isBackspaceKey(key)) {
      rl.clearLine(0);
    } else if (searchEnabled) {
      const searchTerm = rl.line.toLowerCase();
      const matchIndex = items.findIndex((item) => {
        if (Separator.isSeparator(item) || !isSelectable3(item))
          return false;
        return item.name.toLowerCase().startsWith(searchTerm);
      });
      if (matchIndex !== -1) {
        setActive(matchIndex);
      }
      searchTimeoutRef.current = setTimeout(() => {
        rl.clearLine(0);
      }, 700);
    }
  });
  useEffect(() => () => {
    clearTimeout(searchTimeoutRef.current);
  }, []);
  const message = theme.style.message(config.message, status);
  const helpLine = theme.style.keysHelpTip([
    ["\u2191\u2193", "navigate"],
    ["\u23CE", "select"]
  ]);
  let separatorCount = 0;
  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive, index }) {
      if (Separator.isSeparator(item)) {
        separatorCount++;
        return ` ${item.separator}`;
      }
      const cursor = isActive ? theme.icon.cursor : " ";
      const indexLabel = theme.indexMode === "number" ? `${index + 1 - separatorCount}. ` : "";
      if (item.disabled) {
        const disabledLabel = typeof item.disabled === "string" ? item.disabled : "(disabled)";
        const disabledCursor = isActive ? theme.icon.cursor : "-";
        return theme.style.disabled(`${disabledCursor} ${indexLabel}${item.name} ${disabledLabel}`);
      }
      const color = isActive ? theme.style.highlight : (x) => x;
      return color(`${cursor} ${indexLabel}${item.name}`);
    },
    pageSize,
    loop
  });
  if (status === "done") {
    return [prefix, message, theme.style.answer(selectedChoice.short)].filter(Boolean).join(" ");
  }
  const { description } = selectedChoice;
  const lines = [
    [prefix, message].filter(Boolean).join(" "),
    page,
    " ",
    description ? theme.style.description(description) : "",
    errorMsg ? theme.style.error(errorMsg) : "",
    helpLine
  ].filter(Boolean).join("\n").trimEnd();
  return `${lines}${cursorHide}`;
});

// configure.mjs
var import_node_fs2 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path3 = require("node:path");
var import_node_readline = __toESM(require("node:readline"), 1);

// lib/config.mjs
var DEFAULT_SIGNIFIERS = {
  online: { glyph: "\u25CF", color: "green", text: "online" },
  // standard green (greenBright is pale)
  unknown: { glyph: "\u25CC", color: "gray", text: "checking" },
  checking: { glyph: "\u25CC", color: "yellowBright", text: "checking" },
  // retry/reconnect window
  forced: { glyph: "\u25CF", color: "yellowBright", text: "forced" },
  // generic fallback
  forcedOnline: { glyph: "\u25CF", color: "yellowBright", text: "forced online" },
  forcedOffline: { glyph: "\u2298", color: "#FFA500", text: "forced offline", bold: true },
  // slashed dot, orange, bold
  noneReachable: { glyph: "\u2297", color: "redBright", text: "no model", bold: true },
  // nothing reachable (Phase 2 stranding guard)
  suspended: { glyph: "\u2691", color: "yellow", text: "on fallback", bold: false },
  // a rung stall-suspended; we failed over and are WORKING on a lower rung (Phase 3a) — not alarming
  unconfigured: { glyph: "\u2699", color: "gray", text: "not configured" }
  // no primary set → run /pivot setup (first-run onboarding)
};
var DEFAULT_REACHABILITY = {
  // The probe URL MUST be your primary/brain endpoint (not a generic internet
  // check) so "online" tracks brain reachability. Empty by default → reachability
  // condition stays inert until configured.
  probeUrl: "",
  intervalMs: 2e4,
  // steady-state probe cadence (relaxed; light on the network/battery)
  failureThreshold: 2,
  // consecutive failures before flipping to offline (hysteresis)
  recoveryThreshold: 2,
  // consecutive successes before flipping back online
  probeTimeoutMs: 4e3,
  // a hung probe FAILS after this (fast offline detection)
  confirmIntervalMs: 5e3,
  // re-probe quickly while a flip is pending → fast confirmation
  probeAuthEnv: ""
  // NAME of an env var holding a probe token, never the token
};
var DEFAULT_NETWORK_PROBE = {
  probeUrl: "",
  intervalMs: 2e4,
  failureThreshold: 2,
  recoveryThreshold: 2,
  probeTimeoutMs: 4e3,
  confirmIntervalMs: 5e3,
  probeAuthEnv: ""
};
var DEFAULT_STALL = {
  timeoutMs: 9e4
  // cloud default — no completion within this → suspend the rung
};
var LOCAL_STALL_TIMEOUT_MS = 0;
var DEFAULT_STATUSLINE = {
  replacePrimary: false,
  // false → additive line (order:-1), preserves host agent·model (Review #2)
  showModeText: true,
  // false → bare glyphs; a distinct offline glyph then carries meaning
  nearThresholdBand: 0.8
  // metric shows when value ≥ band × ceiling (Review #5)
};
var DEFAULT_OFFLINE_SIGNIFIER = { glyph: "\u25CB", color: "redBright", text: "offline", bold: true };
var KNOWN_CONDITIONS = /* @__PURE__ */ new Set(["reachability", "manual", "cost", "rateLimit"]);
var STATUS_DISPLAY = /* @__PURE__ */ new Set(["always", "near-threshold", "never"]);
function stripJsonc(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}
function normalizeRule(rule, warnings, index) {
  const r = rule && typeof rule === "object" ? rule : {};
  if (!KNOWN_CONDITIONS.has(r.condition)) {
    warnings.push(`rule[${index}]: unknown condition "${r.condition}" (kept; not built in v1 unless it's reachability/manual)`);
  }
  const target = r.target && typeof r.target === "object" ? r.target : {};
  let statusDisplay = r.statusDisplay ?? "near-threshold";
  if (!STATUS_DISPLAY.has(statusDisplay)) {
    warnings.push(`rule[${index}]: invalid statusDisplay "${r.statusDisplay}" \u2192 "near-threshold"`);
    statusDisplay = "near-threshold";
  }
  const isDegraded = r.isDegraded === true;
  const out = {
    condition: r.condition ?? null,
    target: {
      model: target.model ?? null,
      local: target.local === true,
      // marks a local/reachable target (used by the offline hard-gate)
      contextWindow: target.contextWindow ?? void 0,
      reasoningEffort: target.reasoningEffort ?? void 0
    },
    modeLabel: r.modeLabel ?? (isDegraded ? "offline" : r.condition ?? "mode"),
    isDegraded,
    statusDisplay,
    signifier: normalizeSignifier(r.signifier, isDegraded)
  };
  if (r.reachability && typeof r.reachability === "object") {
    out.reachability = { ...DEFAULT_REACHABILITY, ...r.reachability };
  }
  if (r.stall && typeof r.stall === "object" && r.stall.timeoutMs !== void 0) {
    out.stall = { timeoutMs: r.stall.timeoutMs };
  } else if (out.target.local === true) {
    out.stall = { timeoutMs: LOCAL_STALL_TIMEOUT_MS };
  }
  return out;
}
function normalizeSignifier(sig, isDegraded) {
  const base = isDegraded ? DEFAULT_OFFLINE_SIGNIFIER : DEFAULT_SIGNIFIERS.online;
  const s = sig && typeof sig === "object" ? sig : {};
  return {
    glyph: s.glyph ?? base.glyph,
    color: s.color ?? base.color,
    text: s.text ?? base.text,
    bold: s.bold ?? base.bold ?? false
  };
}
function defaultConfig() {
  return {
    primary: null,
    // user must set their primary model handle
    rules: [],
    reachability: { ...DEFAULT_REACHABILITY },
    networkProbe: { ...DEFAULT_NETWORK_PROBE },
    stall: { ...DEFAULT_STALL },
    statusline: { ...DEFAULT_STATUSLINE },
    honesty: "transition",
    // inject the offline note once per degraded episode (Review #3)
    memorySync: { enabled: false },
    // onReconnect callback is wired in code, not JSON
    signifiers: { ...DEFAULT_SIGNIFIERS }
  };
}
function parseConfig(text) {
  const warnings = [];
  let raw;
  try {
    raw = JSON.parse(stripJsonc(text));
  } catch (e) {
    warnings.push(`config is not valid JSONC (${e.message}); using defaults`);
    return { config: defaultConfig(), warnings };
  }
  if (!raw || typeof raw !== "object") {
    warnings.push("config root is not an object; using defaults");
    return { config: defaultConfig(), warnings };
  }
  const base = defaultConfig();
  const rules = Array.isArray(raw.rules) ? raw.rules.map((r, i) => normalizeRule(r, warnings, i)) : [];
  if (!Array.isArray(raw.rules) && raw.rules !== void 0) {
    warnings.push("`rules` is not an array; treating as empty");
  }
  if (!raw.primary) warnings.push("no `primary` model handle set; routing will no-op until configured");
  const honesty = raw.honesty === "every-turn" ? "every-turn" : "transition";
  return {
    config: {
      primary: raw.primary ?? null,
      rules,
      reachability: { ...base.reachability, ...raw.reachability ?? {} },
      networkProbe: { ...base.networkProbe, ...raw.networkProbe ?? {} },
      stall: { ...base.stall, ...raw.stall ?? {} },
      statusline: { ...base.statusline, ...raw.statusline ?? {} },
      honesty,
      memorySync: { enabled: raw.memorySync?.enabled === true },
      signifiers: { ...base.signifiers, ...raw.signifiers ?? {} }
    },
    warnings
  };
}

// lib/configure-core.mjs
var import_node_os = require("node:os");
var import_node_path2 = require("node:path");
var import_node_fs = require("node:fs");
var AUTH_PATH = () => (0, import_node_path2.join)((0, import_node_os.homedir)(), ".letta", "lc-local-backend", "providers", "auth.json");
var SETTINGS_PATH = () => (0, import_node_path2.join)((0, import_node_os.homedir)(), ".letta", "settings.json");
function readJson(path2, deps) {
  try {
    const read = deps.readFile ?? ((p) => (0, import_node_fs.readFileSync)(p, "utf8"));
    return JSON.parse(read(path2));
  } catch {
    return null;
  }
}
var isLocalUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url || "");
function discoverProviders(deps = {}) {
  const auth = readJson(deps.authPath ?? AUTH_PATH(), deps);
  const providers = auth?.providers && typeof auth.providers === "object" ? auth.providers : {};
  return Object.values(providers).map((p) => ({
    name: p?.name ?? p?.id ?? "provider",
    baseUrl: p?.base_url ?? "",
    key: p?.auth?.key ?? ""
  })).filter((p) => p.baseUrl);
}
function recentModels(deps = {}) {
  const s = readJson(deps.settingsPath ?? SETTINGS_PATH(), deps);
  return Array.isArray(s?.recentModels) ? s.recentModels : [];
}
async function discoverModels(deps = {}) {
  const providers = deps.providers ?? discoverProviders(deps);
  const recents = recentModels(deps);
  const handles = [...recents];
  for (const p of providers) {
    const ids = await fetchModels(p.baseUrl, p.key, deps);
    for (const id of ids) {
      const handle = `${p.name}/${id}`;
      if (!handles.includes(handle)) handles.push(handle);
    }
  }
  return { handles, providers };
}
function deriveProbe(primaryHandle, providers) {
  const prefix = String(primaryHandle ?? "").split("/")[0];
  const p = (providers ?? []).find((x) => x.name === prefix);
  if (!p?.baseUrl) return { url: "", isLocal: false, providerName: prefix || null };
  const url = `${p.baseUrl.replace(/\/+$/, "")}/models`;
  return { url, isLocal: isLocalUrl(p.baseUrl), providerName: p.name };
}
async function fetchModels(baseUrl, apiKey, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  try {
    const base = baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
    const res = await fetchFn(`${base}/v1/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    });
    if (!res?.ok) return [];
    const body = await res.json();
    const ids = (body?.data ?? []).map((m) => m?.id).filter((s) => typeof s === "string" && s);
    return ids.filter((id) => id !== "*");
  } catch {
    return [];
  }
}
function buildConfig(a) {
  const rules = [];
  if (a.cloudFallback) {
    const rule = {
      condition: "reachability",
      target: { model: a.cloudFallback, local: false },
      modeLabel: "cloud-fallback",
      isDegraded: false,
      statusDisplay: "near-threshold"
    };
    if (a.cloudFallbackProbeUrl) rule.reachability = { probeUrl: a.cloudFallbackProbeUrl };
    rules.push(rule);
  }
  if (a.offlineModel) {
    const target = { model: a.offlineModel, local: true };
    if (a.contextWindow) target.contextWindow = a.contextWindow;
    if (a.reasoningEffort) target.reasoningEffort = a.reasoningEffort;
    rules.push({
      condition: "reachability",
      target,
      modeLabel: "offline",
      isDegraded: true,
      statusDisplay: "near-threshold",
      signifier: { glyph: "\u25CB", color: "redBright", text: "offline", bold: true }
    });
  }
  return {
    primary: a.primary ?? null,
    rules,
    reachability: {
      probeUrl: a.probeUrl ?? "",
      intervalMs: a.intervalMs ?? 15e3,
      failureThreshold: a.failureThreshold ?? 3,
      recoveryThreshold: a.recoveryThreshold ?? 2,
      probeTimeoutMs: a.probeTimeoutMs ?? 4e3,
      confirmIntervalMs: a.confirmIntervalMs ?? 5e3,
      probeAuthEnv: a.probeAuthEnv ?? ""
    },
    statusline: {
      replacePrimary: a.replacePrimary === true,
      showModeText: a.showModeText !== false,
      nearThresholdBand: a.nearThresholdBand ?? 0.8
    },
    honesty: a.honesty === "every-turn" ? "every-turn" : "transition",
    memorySync: { enabled: a.memorySyncEnabled === true }
  };
}
var NEUTRAL_PROBE_URL = "https://1.1.1.1";
var LOCAL_MODEL_RE = /(local|qwen|glm|llama|mlx|mistral|gemma|phi\b|lmstudio|codestral)/i;
var looksLocal = (handle) => LOCAL_MODEL_RE.test(String(handle).split("/").pop() ?? "");

// configure.mjs
var CONFIG_PATH = (0, import_node_path3.join)((0, import_node_os2.homedir)(), ".letta", "mods", "autopivot.config.json");
var PAGE = 20;
if (process.stdin.isTTY) import_node_readline.default.emitKeypressEvents(process.stdin);
var BACK = /* @__PURE__ */ Symbol("back");
async function ask(promptFn, config) {
  const ac = new AbortController();
  const onKey = (_s, key) => {
    if (key?.name === "escape") ac.abort();
  };
  process.stdin.on("keypress", onKey);
  try {
    return await promptFn(config, { signal: ac.signal });
  } catch (e) {
    if (e?.name === "AbortPromptError" || e?.name === "ExitPromptError") return BACK;
    throw e;
  } finally {
    process.stdin.removeListener("keypress", onKey);
  }
}
var shown = (v) => v == null || v === "" ? "\u2014" : Array.isArray(v) ? v.length ? v.join(", ") : "\u2014" : String(v);
function modelSearchConfig(message, models, def) {
  return {
    message: `${message} \u2014 type to search${def ? `  [current: ${def}]` : ""}:`,
    pageSize: PAGE,
    source: async (term) => {
      const t = String(term ?? "").toLowerCase();
      const matches = models.filter((m) => m.toLowerCase().includes(t));
      const choices = matches.map((m) => ({ name: m, value: m }));
      if (term && !models.includes(term)) choices.unshift({ name: `\u203A use "${term}" (custom handle)`, value: term });
      return choices.length ? choices : models.map((m) => ({ name: m, value: m }));
    }
  };
}
function seedState(cur, models, providers) {
  const cloudModels = models.filter((m) => !looksLocal(m));
  const primary = cur?.primary ?? cloudModels[0] ?? models[0] ?? null;
  const probe = deriveProbe(primary, providers);
  const localRule = (cur?.rules ?? []).find((r) => r?.target?.local);
  const cloudRule = (cur?.rules ?? []).find((r) => r?.target && !r.target.local);
  const seededLocal = (cur?.rules ?? []).filter((r) => r?.target?.local).map((r) => r.target.model);
  return {
    primary,
    cloudFallback: cloudRule?.target?.model ?? cloudModels.find((m) => m !== primary) ?? null,
    // 2nd-most-recent cloud
    localSet: new Set(seededLocal.length ? seededLocal : models.filter(looksLocal)),
    offlineModel: localRule?.target?.model ?? null,
    contextWindow: localRule?.target?.contextWindow,
    probeUrl: cur?.reachability?.probeUrl || (probe.isLocal || !probe.url ? NEUTRAL_PROBE_URL : probe.url),
    probeIsLocal: probe.isLocal,
    intervalMs: cur?.reachability?.intervalMs ?? 15e3,
    failureThreshold: cur?.reachability?.failureThreshold ?? 3,
    showModeText: cur?.statusline?.showModeText ?? true,
    replacePrimary: cur?.statusline?.replacePrimary ?? false,
    honesty: cur?.honesty ?? "transition"
  };
}
var toConfig = (s) => buildConfig({
  primary: s.primary,
  cloudFallback: s.cloudFallback,
  offlineModel: s.offlineModel,
  contextWindow: s.contextWindow,
  probeUrl: s.probeUrl,
  intervalMs: s.intervalMs,
  failureThreshold: s.failureThreshold,
  showModeText: s.showModeText,
  replacePrimary: s.replacePrimary,
  honesty: s.honesty
});
async function editPrimary(s, models) {
  const v = await ask(dist_default8, modelSearchConfig("Primary (online) model", models, s.primary));
  if (v !== BACK) s.primary = v;
}
async function editCloudFallback(s, models) {
  const pool = models.filter((m) => !s.localSet.has(m) && m !== s.primary);
  const choices = [...pool.map((m) => ({ name: m, value: m })), new Separator(), { name: "(none \u2014 no secondary cloud)", value: null }];
  const v = await ask(dist_default9, { message: "Secondary cloud fallback (on primary rate-limit/failure while online)", pageSize: PAGE, choices, default: s.cloudFallback ?? null });
  if (v !== BACK) s.cloudFallback = v;
}
async function editLocal(s, models) {
  if (!models.length) return;
  const v = await ask(dist_default4, {
    message: "Check which models are LOCAL (space toggles; pre-checked = our guess \u2014 verify):",
    pageSize: PAGE,
    choices: models.map((m) => ({ name: m, value: m, checked: s.localSet.has(m) }))
  });
  if (v === BACK) return;
  s.localSet = new Set(v);
  if (s.offlineModel && !s.localSet.has(s.offlineModel)) s.offlineModel = null;
}
async function editFallback(s, models) {
  const pool = s.localSet.size ? [...s.localSet].filter((m) => m !== s.primary) : models.filter((m) => m !== s.primary);
  if (!pool.length) {
    console.log("  (no eligible model \u2014 mark a local model first)");
    return;
  }
  const choices = [...pool.map((m) => ({ name: m, value: m })), { name: "(none \u2014 primary-only ladder)", value: null }];
  const v = await ask(dist_default9, { message: "Offline / local fallback model", pageSize: PAGE, choices, default: s.offlineModel ?? pool[0] });
  if (v === BACK) return;
  s.offlineModel = v;
  if (s.offlineModel) {
    const cw = await ask(dist_default7, { message: "Offline context window in tokens (blank = model default):", required: false, default: s.contextWindow });
    if (cw !== BACK) s.contextWindow = cw;
  }
}
async function editProbe(s) {
  if (s.probeIsLocal) console.log(`  \u26A0 couldn't derive a specific endpoint (localhost proxy) \u2192 defaulting to an internet check (${NEUTRAL_PROBE_URL}), which handles "offline \u2192 go local." For a SPECIFIC server (detect that box being down), enter its URL instead.`);
  const url = await ask(dist_default6, { message: "Reachability probe URL (returns <500 when your brain is reachable):", default: s.probeUrl || void 0 });
  if (url === BACK) return;
  s.probeUrl = url;
  const iv = await ask(dist_default7, { message: "Steady probe interval (ms):", default: s.intervalMs });
  if (iv === BACK) return;
  s.intervalMs = iv;
  const ft = await ask(dist_default7, { message: "Failed probes before going offline:", default: s.failureThreshold });
  if (ft !== BACK) s.failureThreshold = ft;
}
async function editOptions(s) {
  const a = await ask(dist_default5, { message: "Show mode text on the pill (e.g. 'offline')?", default: s.showModeText });
  if (a === BACK) return;
  s.showModeText = a;
  const b = await ask(dist_default5, { message: "Replace the host's agent\xB7model statusline line (vs an additive line)?", default: s.replacePrimary });
  if (b === BACK) return;
  s.replacePrimary = b;
  const c = await ask(dist_default5, { message: "Inject the honest-offline note only on transition (vs every offline turn)?", default: s.honesty === "transition" });
  if (c !== BACK) s.honesty = c ? "transition" : "every-turn";
}
async function saveConfig(s) {
  const config = toConfig(s);
  const { warnings } = parseConfig(JSON.stringify(config));
  console.log("\nConfig preview:\n" + JSON.stringify(config, null, 2));
  if (warnings.length) {
    console.log("\n\u26A0 validation warnings:");
    for (const w of warnings) console.log("  - " + w);
  }
  const ok = await ask(dist_default5, { message: `Write to ${CONFIG_PATH}?`, default: true });
  if (ok === BACK || !ok) return false;
  if ((0, import_node_fs2.existsSync)(CONFIG_PATH)) {
    (0, import_node_fs2.copyFileSync)(CONFIG_PATH, `${CONFIG_PATH}.bak`);
    console.log(`Backed up existing \u2192 ${CONFIG_PATH}.bak`);
  }
  (0, import_node_fs2.writeFileSync)(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`
\u2713 Wrote ${CONFIG_PATH}
  Run /reload in your Letta Code TUI to apply.
`);
  return true;
}
async function main() {
  console.log("\nAutoPivot configurator\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  let cur = null;
  if ((0, import_node_fs2.existsSync)(CONFIG_PATH)) {
    try {
      cur = parseConfig((0, import_node_fs2.readFileSync)(CONFIG_PATH, "utf8")).config;
      console.log(`Editing existing config (${CONFIG_PATH})`);
    } catch {
    }
  }
  console.log("Discovering your models from connected providers\u2026");
  const { handles: models, providers } = await discoverModels();
  console.log(models.length ? `Found ${models.length} model(s) across ${providers.length} provider(s).` : "No models auto-discovered \u2014 you can type handles manually.");
  const s = seedState(cur, models, providers);
  console.log("(Tip: Esc or Ctrl-C skips/backs out of a field.)\n");
  await editPrimary(s, models);
  await editCloudFallback(s, models);
  await editLocal(s, models);
  await editFallback(s, models);
  await editProbe(s);
  for (; ; ) {
    const choice = await ask(dist_default9, {
      message: "Review \u2014 Save (highlighted), or edit any field:",
      pageSize: PAGE,
      default: "save",
      choices: [
        { name: `Primary model      ${shown(s.primary)}`, value: "primary" },
        { name: `Cloud fallback     ${shown(s.cloudFallback)}`, value: "cloudfb" },
        { name: `Local models       ${shown([...s.localSet])}`, value: "local" },
        { name: `Offline fallback   ${shown(s.offlineModel)}`, value: "fallback" },
        { name: `Reachability probe ${shown(s.probeUrl)}`, value: "probe" },
        { name: `Options            text:${s.showModeText} replace:${s.replacePrimary} honesty:${s.honesty}`, value: "options" },
        new Separator(),
        { name: "\u2713 Save & write config", value: "save" },
        { name: "\u2717 Cancel (discard)", value: "cancel" }
      ]
    });
    if (choice === BACK || choice === "cancel") {
      console.log("Cancelled \u2014 nothing written.");
      return;
    }
    if (choice === "save") {
      if (await saveConfig(s)) return;
      else continue;
    }
    if (choice === "primary") await editPrimary(s, models);
    else if (choice === "cloudfb") await editCloudFallback(s, models);
    else if (choice === "local") await editLocal(s, models);
    else if (choice === "fallback") await editFallback(s, models);
    else if (choice === "probe") await editProbe(s);
    else if (choice === "options") await editOptions(s);
  }
}
main().catch((e) => {
  if (e?.name === "ExitPromptError") {
    console.log("\nCancelled.");
    process.exit(0);
  }
  console.error("Error:", e?.message ?? e);
  process.exit(1);
});
