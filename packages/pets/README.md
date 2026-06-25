# Pets

A small terminal pet for Letta Code.

## Usage

```text
/pets [cat|dog|bunny|blob] [name=<name>]
/pets status
/pets stop
```

Examples:

```text
/pets cat name=gato
/pets bunny name=hoppy
/pets blob name=bloop
```

The pet animates in the panel area and changes movement based on what Letta Code is doing:

- thinking when a turn starts
- moving while work is happening
- terminal animation for shell commands
- reading animation for read/search tools
- writing animation for edits/patches
- waiting animation for user prompts

The pet returns to idle after activity stops.
