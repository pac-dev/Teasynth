# Teasynth: an Audio Programming Tool

Teasynth is a tool to make music with code in Javascript, [Faust](https://faust.grame.fr/) and [Sporth](https://paulbatchelor.github.io/proj/sporth.html). There are two main ways of using it:

- The **web editor** runs in the browser and provides an instant composition environment.
- The **command line interface** can render music to audio files, serve the editor locally, and bundle music code.

## What does it sound like?

Teasynth was used to produce all the audio in [ambient.garden](https://ambient.garden/). The related album "A Walk Through the Ambient Garden" was also produced entirely using Teasynth. You can [build it from source](https://github.com/pac-dev/AmbientGardenAlbum) or listen to it on [Spotify](https://open.spotify.com/album/6RPvBkBjCymWOk7BeONDv4) and [Apple Music](https://music.apple.com/us/album/a-walk-through-the-ambient-garden/1732863542). While these are ambient, Teasynth is, of course, not limited to any particular genre.

## Using the Web Editor

The editor is available on [ts.osar.fr](https://ts.osar.fr/). You can also serve it yourself or build it as a static site using the command line (see the "command line" section below). Its main features are:

- **Load** and **save** a local directory. The loaded directory is the current **project**, and you can edit files and folders in the project.

- The **code editor** component is VSCode's Monaco. It features inline help and autocomplete for JS and Faust, and a command palette with keybindings that should be familiar if you've used VSCode.

- **Play** and **stop** the current audio patch. A patch is any directory containing a `main.js` file exporting a `process` function that generates audio frame-by-frame. See the example patches for more details.

- **Sliders** to control the parameters of any currently running audio patch.

- An experimental **macro** system. Create a macro file and record a performance where you start/stop patches and modify their parameters. Macros are simple text files that can be edited, played back, and rendered.

- **Feedback in the browser console**. The editor is meant to run with the browser console enabled.

## Using the Command Line

The Teasynth command line requires Deno. If you haven't used Deno, you can download it as a [single binary](https://github.com/denoland/deno/releases) or [install it properly](https://docs.deno.com/runtime/manual) if you prefer. Subcommands that produce audio files also require [ffmpeg](https://ffmpeg.org/download.html) to be present. The following help text, included in the tool, describes all subcommands:

```
Optionally install with: deno install -A teasynth.js
If installed, invoke with: teasynth
Otherwise, use: deno run -A teasynth.js

SUBCOMMAND: RENDER
------------------
Render a patch to an audio file.
Usage: teasynth render MAINFILE OUTFILE [-t=DURATION] [--p-PARAM=X ...]
Arguments:
    MAINFILE        path to the main.js of the patch to render
    OUTFILE         path to the output audio file
    -t=DURATION     seconds of audio to render, default 10
    --p-PARAM=X     set value of patch parameter PARAM to X
Example 1: teasynth render projects/startup/1-welcome/main.js test.wav
    Renders the included test file for the default 10 seconds
Example 2: teasynth render example/main.js test.wav --p-lopass=500 --p-hipass=900
    Renders an example patch with values for parameters "lopass" and "hipass"

SUBCOMMAND: BUILD
-----------------
Build patches from a project into js+wasm bundles.
Usage: teasynth build PROJDIR OUTDIR [--patch=NAME ...]
Arguments:
    PROJDIR         path to project directory containing patches
    OUTDIR          path to output directory
    --patch=X       only build specified patches
Example 1: teasynth build projects/startup/ bundles/
    Build all patches in the included test project to the "bundles" folder
Example 2: teasynth build example/ bundles/ --patch=bell --patch=whistle
    Build only "bell" and "whistle" patches of an example project

SUBCOMMAND: SERVE-EDITOR
------------------------
Serve the Teasynth web editor locally.
Usage: teasynth serve-editor [--config=FILE]
Arguments:
    --config=FILE   optional path to configuration file.
                    the default is cli/config.default.json

SUBCOMMAND: GENERATE-EDITOR
---------------------------
Generate the Teasynth editor static website for deployment.
Usage: teasynth generate-editor OUTDIR [--config FILE] [-y]
Arguments:
    OUTDIR          path to output directory
    --config=FILE   optional path to configuration file.
                    the default is cli/config.default.json
    -y              answer "yes" to all confirmation prompts

SUBCOMMAND: MACRO
-----------------
Render a macro file to an audio file.
Usage: teasynth macro PROJDIR MACFILE OUTFILE
Arguments:
    PROJDIR         path to project directory containing patches
    MACFILE         path to macro text file
    OUTFILE         path to the output audio file
```

## What makes Teasynth different from other livecoding options?

- **The code is the music**. Teasynth is ideal for a style sometimes called "the code is the music", meaning your code runs without intervention to make a finished music piece. This contrasts with performance-centric livecoding, where you write and/or update code as part of a performance. Each approach has different advantages, but in short, "the code is the music" offers more freedom in how you structure your music and your code, at the expense of interrupting the music every time you want to reload the code.
- **Full sounds without samples**. A lot of livecoding environments assume you want to work with existing sound samples or instruments. Making sound from scratch is often second class and/or results in old school bleep-bloop noises. Teasynth is designed to make interesting, polished sounds from scratch without samples, especially when using the integration with [Faust](https://faust.grame.fr/).
- **Javascript**. While Faust is ideal for low-level synth and effect code, Javascript takes on the high level, composition portion. It may not be the most loved, but it works. A scripting language that has received more optimization than any other. Temporal recursion with async/await. DSP modules compiled to WASM. [Direct integration with the holy trinity](https://javascriptwtf.com/wtf/javascript-holy-trinity). You can have it all.

## Limitations

- The web editor is meant for desktop browsers and does not work well on smartphones.
- While the timing within patches is generally sample-accurate, the experimental macro system is not. It's more like "second-accurate", so if you like rhythm, you might want to avoid macros specifically. However, macros are at least timed precisely when rendered from the command line.