export const registerSporth = () => {
	const ugenWords = [...Object.keys(ugens)];
	monaco.languages.register({ id: 'sporth' });
	monaco.languages.setMonarchTokensProvider('sporth', {
		// Set defaultToken to invalid to see what you do not tokenize yet
		defaultToken: 'invalid',
		comments: { lineComment: '#' },
		keywords: ugenWords,
		tokenizer: {
			root: [
				{ include: '@whitespace' },
				[/([a-z_\*\+\%\^\&\|\/$])[\w$]*/, {
					cases: {
						'@keywords': 'keyword',
						'@default': 'identifier'
					}
				}],
				[/\d+/, 'number'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'], // non-teminated string
				[/'([^'\\]|\\.)*$/, 'string.invalid'], // non-teminated string
				[/"/, 'string', '@string."'],
				[/'/, 'string', "@string.'"]
			],
			whitespace: [
				[/[ \t\r\n]+/, ''],
				[/#.*$/, 'comment']
			],
			string: [
				[/[^\\"']+/, 'string'],
				[
					/["']/,
					{
						cases: {
							'$#==$S2': { token: 'string', next: '@pop' },
							'@default': 'string'
						}
					}
				]
			]
		},
	});
	// Register a completion item provider for the new language
	monaco.languages.registerCompletionItemProvider('sporth', {
		provideCompletionItems: () => {
			return { suggestions: ugenWords.filter(w => w.length > 1).map(w => ({
				label: w,
				kind: monaco.languages.CompletionItemKind.Text,
				insertText: w,
				documentation: `${ugens[w].Description}\n${ugens[w].Args.join(', ')} -> ${ugens[w].Outputs}`
			})) };
		}
	});
	
	monaco.languages.registerHoverProvider('sporth', {
		provideHover: function(model, position) { 
			const wordAtPos = model.getWordAtPosition(position).word;
			const ugen = ugens[wordAtPos];
			if (!ugen) return;
			return {
				contents: [
					{ value: `**${wordAtPos}**` },
					{ value: `${ugen.Description}\n\n**${ugen.Args.join(', ')}** -> **${ugen.Outputs}**` }
				]
			}
		}
	});

}


export const ugens = {
'%': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'Performs modulus operation.'},
'&': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'Performs logical "and" operation.'},
'/': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'Performs division.'},
'abs': { 'Args': [ 'v1' ], 'Outputs': 1 , 'Description': 'Performs absolute value.'},
'add': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'Performs addition.'},
'adsr': { 'Args': [ 'gate', 'attack', 'decay', 'sustain', 'release' ], 'Outputs': 1 , 'Description': 'Analogue modelled ADSR generator'},
'allpass': { 'Args': [ 'revtime', 'looptime' ], 'Outputs': 1 , 'Description': 'allpass filter'},
'ampdb': { 'Args': [ 'db' ], 'Outputs': 1 , 'Description': 'converts decibels to amplitude'},
'atone': { 'Args': [ 'cutoff' ], 'Outputs': 1 , 'Description': 'simple one-pole high pass filter'},
'autowah': { 'Args': [ 'level', 'wah', 'mix' ], 'Outputs': 1 , 'Description': 'autowah'},
'bal': { 'Args': [ 'reference', 'in' ], 'Outputs': 1 , 'Description': 'match the input\'s amplitude the reference\'s amplitude'},
'biscale': { 'Args': [ 'v1', 'min', 'max' ], 'Outputs': 1 , 'Description': 'Scales from bipolar [-1, 1] to [min, max].'},
'bitcrush': { 'Args': [ 'bitdepth (8)', 'samplerate (10000)' ], 'Outputs': 1 , 'Description': 'bitcrusher. bitdepth: 1 - 16'},
'blsaw': { 'Args': [ 'freq', 'amp' ], 'Outputs': 1 , 'Description': 'Band-limited sawtooth oscillator'},
'blsquare': { 'Args': [ 'freq', 'width (0.5)', 'amp' ], 'Outputs': 1 , 'Description': 'Band-limited square oscillator with pulse-width'},
'bltriangle': { 'Args': [ 'freq', 'amp' ], 'Outputs': 1 , 'Description': 'Band-limited triangle oscillator'},
'bpm2dur': { 'Args': [ 'bpm' ], 'Outputs': 1 , 'Description': 'convert bpm to duration (seconds)'},
'bpm2rate': { 'Args': [ 'bpm' ], 'Outputs': 1 , 'Description': 'convert bpm to rate (Hertz)'},
'branch': { 'Args': [ 'gate', 'sig1', 'sig2' ], 'Outputs': 1 , 'Description': 'returns signal based on state of gate (0 = sig1, 1 = sig2)'},
'brown': { 'Args': [  ], 'Outputs': 1 , 'Description': 'Brownian noise generator'},
'butbp': { 'Args': [ 'in', 'freq', 'bw' ], 'Outputs': 1 , 'Description': 'butterworth bandpass filter'},
'butbr': { 'Args': [ 'in', 'freq', 'bw' ], 'Outputs': 1 , 'Description': 'butterworth band reject filter'},
'buthp': { 'Args': [ 'in', 'cutoff' ], 'Outputs': 1 , 'Description': 'Butterworth highpass filter'},
'butlp': { 'Args': [ 'in', 'cutoff' ], 'Outputs': 1 , 'Description': 'Butterworth lowpass filter'},
'c': { 'Args': [ 'init value' ], 'Outputs': 1 , 'Description': 'Constant generator, used for feedback loops.'},
'cf': { 'Args': [ 'sig1', 'sig2', 'pos' ], 'Outputs': 1 , 'Description': 'crossfade two signals'},
'changed': { 'Args': [ 'sig' ], 'Outputs': 1 , 'Description': 'Returns a trigger if the input changes'},
'clip': { 'Args': [ 'in', 'limit (1)' ], 'Outputs': 1 , 'Description': 'clip limiter / distortion'},
'clock': { 'Args': [ 'trig', 'bpm', 'subdiv' ], 'Outputs': 1 , 'Description': 'Clock with subdivisions and triggerable reset'},
'comb': { 'Args': [ 'in', 'rev time', 'loop time' ], 'Outputs': 1 , 'Description': 'comb filter'},
'conv': { 'Args': [ 'in', 'delay', 'ftbl impulse response' ], 'Outputs': 1 , 'Description': 'partitioned convolution'},
'count': { 'Args': [ 'trig', 'max', 'mode' ], 'Outputs': 1 , 'Description': 'clock counter. mode: 0 = loop, 1 = one-shot'},
'crossfade': { 'Args': [ 'sig1', 'sig2', 'pos' ], 'Outputs': 1 , 'Description': 'crossfade two signals'},
'dcblk': { 'Args': [ 'f' ], 'Outputs': 1 , 'Description': 'dc block filter.'},
'delay': { 'Args': [ 'in', 'feedback', 'deltime' ], 'Outputs': 1 , 'Description': 'feedback delay'},
'diode': { 'Args': [ 'in', 'cutoff', 'res' ], 'Outputs': 1 , 'Description': 'Diode ladder filter'},
'dist': { 'Args': [ 'pregain (1)', 'gain (1)', 'shape1 (0)', 'shape2 (0)' ], 'Outputs': 1 , 'Description': 'Distortion'},
'div': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'Performs division.'},
'dmetro': { 'Args': [ 'time' ], 'Outputs': 1 , 'Description': 'Metronome using time instead of frequency'},
'drip': { 'Args': [ 'trig', 'num_tubes', 'amp', 'shake_max', 'main freq', 'res freq 1', 'res freq 2', 'decay' ], 'Outputs': 1 , 'Description': 'dripwater physical model'},
'drop': { 'Args': [ 'f' ], 'Outputs': 1 , 'Description': 'Removes the last item on the stack.'},
'dtrig': { 'Args': [ 'trig', 'loop', 'delay', 'scale', 'tbl' ], 'Outputs': 1 , 'Description': 'delta trig. loop = 1 will loop the sequence'},
'dup': { 'Args': [ 'f' ], 'Outputs': 2 , 'Description': 'Duplicates last item on the stack.'},
'dup2': { 'Args': [ 'f', 'f' ], 'Outputs': 4 , 'Description': 'Duplicates the two last item on the stack.'},
'dur': { 'Args': [  ], 'Outputs': 1 , 'Description': 'returns duration of sporth patch (in seconds)'},
'dust': { 'Args': [ 'amp', 'density', 'bipolar' ], 'Outputs': 1 , 'Description': 'dust. bipolar = 1 unipolar = 0'},
'eq': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'conditional equals'},
'eqfil': { 'Args': [ 'in(f) freq', 'bw', 'gain' ], 'Outputs': 1 , 'Description': 'eq filter'},
'expon': { 'Args': [ 'trig', 'ia', 'idur', 'ib' ], 'Outputs': 1 , 'Description': 'exponential line segment'},
'f': { 'Args': [ 'num' ], 'Outputs': 0 , 'Description': 'Call a user defined function'},
'floor': { 'Args': [ 'v1' ], 'Outputs': 1 , 'Description': 'Performs flooring, returning the integer part.'},
'fm': { 'Args': [ 'frequency', 'amplitude', 'carrier (1)', 'modulator (1)', 'index (8)' ], 'Outputs': 1 , 'Description': 'A simple FM oscillator.'},
'fof': { 'Args': [ 'amp', 'fund', 'form', 'oct', 'band', 'ris', 'dec', 'dur', 'iphs', 'iolaps', 'window table', 'sine table' ], 'Outputs': 1 , 'Description': 'fof'},
'fofilt': { 'Args': [ 'in', 'freq (1000)', 'atk (0.007)', 'rel (0.04)' ], 'Outputs': 1 , 'Description': 'Formant filter'},
'fog': { 'Args': [ 'amp', 'dense', 'trans', 'spd', 'oct', 'band', 'ris', 'dec', 'dur', 'iphs', 'iolaps', 'window table', 'wav table' ], 'Outputs': 1 , 'Description': 'fog'},
'fosc': { 'Args': [ 'freq', 'amp', 'carrier', 'modulator', 'index', 'table' ], 'Outputs': 1 , 'Description': 'FM oscillator'},
'frac': { 'Args': [ 'v1' ], 'Outputs': 1 , 'Description': 'Returns the fractional part of item on the stack.'},
'gbuzz': { 'Args': [ 'freq', 'amp', 'nharm', 'lharm', 'mul' ], 'Outputs': 1 , 'Description': 'Series of partials from the harmonic series'},
'gen_composite': { 'Args': [ 'name', 'size', 'args' ], 'Outputs': 1 , 'Description': 'Generate a composite waveform of sinusoids.'},
'gen_eval': { 'Args': [ 'name', 'size', 'string' ], 'Outputs': 1 , 'Description': 'Evaluates sporth string to table'},
'gen_line': { 'Args': [ 'name', 'size', 'args' ], 'Outputs': 1 , 'Description': 'Generates a line from ordered list of breakpoints.'},
'gen_padsynth': { 'Args': [ 'ftname', 'size', 'base freq', 'bandwidth', 'amp table' ], 'Outputs': 1 , 'Description': 'padsynth algorithm by Paul Nasca Octavian'},
'gen_rand': { 'Args': [ 'name', 'size', 'args' ], 'Outputs': 1 , 'Description': 'random distribution generator'},
'gen_sine': { 'Args': [ 'ftable name', 'size' ], 'Outputs': 1 , 'Description': 'Generates a sine wave ftable.'},
'gen_sinesum': { 'Args': [ 'name', 'size', 'args' ], 'Outputs': 1 , 'Description': 'Summation of harmonically related sines. based on GEN10.'},
'gen_vals': { 'Args': [ 'name', 'args' ], 'Outputs': 1 , 'Description': 'Generates an ftable from a space delimited set of values.'},
'get': { 'Args': [ 'name' ], 'Outputs': 1 , 'Description': 'gets variable'},
'gt': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'conditional greater than'},
'hilbert': { 'Args': [ 'in' ], 'Outputs': 2 , 'Description': 'hilbert transform'},
'in': { 'Args': [  ], 'Outputs': 1 , 'Description': 'Read a float from STDIN.'},
'incr': { 'Args': [ 'trig', 'step', 'min', 'max', 'ival' ], 'Outputs': 1 , 'Description': 'Incrementer'},
'inv': { 'Args': [ 'inv' ], 'Outputs': 1 , 'Description': 'inverse a signal 1/x'},
'jcrev': { 'Args': [ 'input' ], 'Outputs': 1 , 'Description': 'Chowning reverb'},
'jitter': { 'Args': [ 'amp', 'cpsMin', 'cpsMax' ], 'Outputs': 1 , 'Description': 'Jitter control signal'},
'line': { 'Args': [ 'trig', 'ia', 'idur', 'ib' ], 'Outputs': 1 , 'Description': 'line segment'},
'log': { 'Args': [ 'v1' ], 'Outputs': 1 , 'Description': 'Performs natural logarithm.'},
'log10': { 'Args': [ 'v1' ], 'Outputs': 1 , 'Description': 'Performs base 10 logarithm.'},
'lpc': { 'Args': [ 'in', 'framesize' ], 'Outputs': 1 , 'Description': 'apply linear-predictive coding (LPC10) to signal'},
'lpcsynth': { 'Args': [ 'framesize', 'ftbl' ], 'Outputs': 1 , 'Description': 'LPC synth. Manipulate parameters directly.'},
'lpf18': { 'Args': [ 'in', 'freq', 'res', 'dist' ], 'Outputs': 1 , 'Description': 'low pass filter with tanh distortion'},
'lsys': { 'Args': [ 'trig', 'ord', 'code' ], 'Outputs': 1 , 'Description': 'L-Systems microlanguage'},
'lt': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'conditional lt'},
'max': { 'Args': [ 'f', 'f' ], 'Outputs': 1 , 'Description': 'Returns the greater of two items on the stack.'},
'maygate': { 'Args': [ 'trig', 'probability (0.5)' ], 'Outputs': 1 , 'Description': 'Random selection of gate or no gate.'},
'maytrig': { 'Args': [ 'trig', 'probability (0.5)' ], 'Outputs': 1 , 'Description': 'Random selection of trig or no trig.'},
'metro': { 'Args': [ 'frequency' ], 'Outputs': 1 , 'Description': 'Creates clock signal.'},
'min': { 'Args': [ 'f', 'f' ], 'Outputs': 1 , 'Description': 'Returns the lesser of two items on the stack.'},
'mincer': { 'Args': [ 'time', 'amp', 'pitch ratio (1)', 'winsize (2048)', 'ftable' ], 'Outputs': 1 , 'Description': 'Phase-locked vocoder'},
'mix': { 'Args': [ 'f..f' ], 'Outputs': 1 , 'Description': 'Sums up remaining items on stack.'},
'mode': { 'Args': [ 'in', 'freq (500)', 'Q (50)' ], 'Outputs': 1 , 'Description': 'modal filter'},
'moogladder': { 'Args': [ 'input', 'cutoff', 'res' ], 'Outputs': 1 , 'Description': 'Moog ladder lowpass filter'},
'mtof': { 'Args': [ 'Note number' ], 'Outputs': 1 , 'Description': 'Converts MIDI note number to Hz.'},
'mul': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'Performs multiplication.'},
'ne': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'conditional not-equal to'},
'noise': { 'Args': [ 'gain' ], 'Outputs': 1 , 'Description': 'White noise generator.'},
'osc': { 'Args': [ 'freq', 'amp', 'phase', 'ft name' ], 'Outputs': 1 , 'Description': 'Wavetable lookup oscillator'},
'oscmorph2': { 'Args': [ 'freq', 'amp', 'wtpos', 'phase', 'ft1', 'ft2' ], 'Outputs': 1 , 'Description': '2-table morphing oscillator'},
'oscmorph4': { 'Args': [ 'freq', 'amp', 'wtpos', 'phase', 'ft1', 'ft2', 'ft3', 'ft4' ], 'Outputs': 1 , 'Description': '4-table morphing oscillator'},
'p': { 'Args': [ 'num' ], 'Outputs': 1 , 'Description': 'p register get'},
'palias': { 'Args': [ 'name', 'index' ], 'Outputs': 1 , 'Description': 'create a variable alias for p-value'},
'pan': { 'Args': [ 'in', 'pan' ], 'Outputs': 1 , 'Description': 'Equal power panning. -1 = hardL 1 = hardR'},
'pareq': { 'Args': [ 'in', 'freq', 'boost', 'Q', 'mode(0=peak, 1=low shelf, 2= high shelf)' ], 'Outputs': 1 , 'Description': 'parametric equalizer'},
'pdhalf': { 'Args': [ 'amount -1 to 1' ], 'Outputs': 1 , 'Description': 'casio phasor distortion'},
'peaklim': { 'Args': [ 'input', 'atk', 'rel', 'thresh db' ], 'Outputs': 1 , 'Description': 'peak limiter'},
'phaser': { 'Args': [ 'inl', 'in2', 'max notch', 'min notch', 'width', 'notch freq', 'depth', 'fdbk', 'invert', 'lvl', 'lfobpm' ], 'Outputs': 2 , 'Description': 'stereo phaser'},
'phasor': { 'Args': [ 'freq', 'phase' ], 'Outputs': 1 , 'Description': 'Normalized sawtooth wave.'},
'pinknoise': { 'Args': [ 'amp' ], 'Outputs': 1 , 'Description': 'pink noise generator'},
'pluck': { 'Args': [ 'trigger', 'freq', 'amp', 'ifreq (110)' ], 'Outputs': 1 , 'Description': 'plucked instrument. ifreq sets the lowest frequency (buffer size).'},
'port': { 'Args': [ 'htime (0.02)' ], 'Outputs': 1 , 'Description': 'Applies portamento to a signal.'},
'pos': { 'Args': [  ], 'Outputs': 1 , 'Description': 'returns playing time, in seconds'},
'posc3': { 'Args': [ 'freq', 'amp', 'ftable' ], 'Outputs': 1 , 'Description': 'high-precision oscillator with cubic interpolation'},
'prop': { 'Args': [ 'bpm', 'prop string' ], 'Outputs': 1 , 'Description': 'Parses prop code to produce a set of triggers'},
'pset': { 'Args': [ 'val', 'num' ], 'Outputs': 1 , 'Description': 'p register set'},
'pshift': { 'Args': [ 'in', 'shift (semitones)', 'window size (samps)', 'xfade (samps)' ], 'Outputs': 1 , 'Description': 'pitch shifter'},
'ptrack': { 'Args': [ 'in' ], 'Outputs': 2 , 'Description': 'pitch tracking (outputs: amp, pitch)'},
'rand': { 'Args': [ 'min', 'max' ], 'Outputs': 1 , 'Description': 'picks random number at start time'},
'randh': { 'Args': [ 'min', 'max', 'freq' ], 'Outputs': 1 , 'Description': 'Random hold'},
'randi': { 'Args': [ 'min', 'max', 'freq' ], 'Outputs': 1 , 'Description': 'Randomized line segment with interpolation'},
'ref': { 'Args': [ 'name' ], 'Outputs': 1 , 'Description': 'save pointer reference of next pipe in table'},
'reson': { 'Args': [ 'in', 'freq', 'bw' ], 'Outputs': 1 , 'Description': 'resonator filter'},
'reverse': { 'Args': [ 'in', 'delay' ], 'Outputs': 1 , 'Description': 'reverse delay'},
'revsc': { 'Args': [ 'in1', 'in2', 'feedback (0.97)', 'cutoff (10000)' ], 'Outputs': 2 , 'Description': 'Stereo reverb module from reverbsc Csound opcode.'},
'rot': { 'Args': [ 'f', 'f', 'f' ], 'Outputs': 3 , 'Description': 'Stack rotate. s: 1 2 3 -> 2 3 1'},
'round': { 'Args': [ 'v1' ], 'Outputs': 1 , 'Description': 'Performs rounding to nearest integer.'},
'rpt': { 'Args': [ 'in', 'trig', 'bpm', 'div', 'rep', 'bufsize (1)' ], 'Outputs': 1 , 'Description': 'Stutterer / repeater (bufsize in seconds)'},
'rspline': { 'Args': [ 'min', 'max', 'cps min', 'cps max' ], 'Outputs': 1 , 'Description': 'random spline generator'},
'samphold': { 'Args': [ 'in', 'trig' ], 'Outputs': 1 , 'Description': 'sample and hold'},
'saturator': { 'Args': [ 'in', 'drive', 'dcoffset' ], 'Outputs': 1 , 'Description': 'saturator distortion unit'},
'scale': { 'Args': [ 'v1', 'min', 'max' ], 'Outputs': 1 , 'Description': 'Scales from unipolar [0, 1] to [min, max].'},
'sdelay': { 'Args': [ 'delay' ], 'Outputs': 1 , 'Description': 'delay (in samples)'},
'set': { 'Args': [ 'value', 'name' ], 'Outputs': 1 , 'Description': 'sets variable'},
'setdurs': { 'Args': [ 'size' ], 'Outputs': 1 , 'Description': 'set total duration (in samples)'},
'sget': { 'Args': [ 'index', 'ftname' ], 'Outputs': 1 , 'Description': 'picks a string from a string list'},
'sine': { 'Args': [ 'freq', 'amp' ], 'Outputs': 1 , 'Description': 'Simple sine oscillator.'},
'slice': { 'Args': [ 'trig', 'id', 'vals', 'buf' ], 'Outputs': 1 , 'Description': 'in-memory slice based sampler'},
'slick': { 'Args': [ 'ftname' ], 'Outputs': 1 , 'Description': 'picks a string randomly from string list'},
'smoothdelay': { 'Args': [ 'in(f) fdbk(f) del(f) maxdel(f) interp' ], 'Outputs': 1 , 'Description': 'smooth delay line'},
'sqrt': { 'Args': [ 'in' ], 'Outputs': 1 , 'Description': 'square root'},
'sr': { 'Args': [  ], 'Outputs': 1 , 'Description': 'Returns the sample rate'},
'srand': { 'Args': [ 'seed' ], 'Outputs': 1 , 'Description': 'seed internal RNG'},
'streson': { 'Args': [ 'in', 'frequency', 'gain' ], 'Outputs': 1 , 'Description': 'String resonator filter'},
'sub': { 'Args': [ 'v1', 'v2' ], 'Outputs': 1 , 'Description': 'Performs subtraction.'},
'swap': { 'Args': [ 'f', 'f' ], 'Outputs': 2 , 'Description': 'Swaps last two items on the stack.'},
'switch': { 'Args': [ 'trig', 'sig1', 'sig2' ], 'Outputs': 1 , 'Description': 'toggle between two signals'},
'tabread': { 'Args': [ 'index', 'scaled (1: yes, 0: no)', 'offset', 'wrap', 'ftname' ], 'Outputs': 1 , 'Description': 'read from table with interpolation'},
'tadsr': { 'Args': [ 'trig', 'attack', 'decay', 'sustain', 'release' ], 'Outputs': 1 , 'Description': 'Triggerable digital-style ADSR envelope. Use trigger as a toggle.'},
'talias': { 'Args': [ 'name', 'index', 'ftbl' ], 'Outputs': 1 , 'Description': 'alias a table value to a variable'},
'talkbox': { 'Args': [ 'source', 'excitation', 'quality' ], 'Outputs': 1 , 'Description': 'high-resolution vocoder'},
'tbldur': { 'Args': [ 'ftable' ], 'Outputs': 1 , 'Description': 'Get duration of table (in seconds)'},
'tblrec': { 'Args': [ 'in', 'trig', 'tbl name' ], 'Outputs': 1 , 'Description': 'records values to table.'},
'tblsize': { 'Args': [ 'ftable' ], 'Outputs': 1 , 'Description': 'Get size of table (in samples)'},
'tdiv': { 'Args': [ 'trigger', 'num', 'offset' ], 'Outputs': 1 , 'Description': 'trigger divider'},
'tenv': { 'Args': [ 'trig', 'attack', 'sustain', 'release' ], 'Outputs': 1 , 'Description': 'Triggerable linear envelope generator. Values in seconds.'},
'tenv2': { 'Args': [ 'trig', 'attack', 'release' ], 'Outputs': 1 , 'Description': 'Two-step triggerable linear envelope generator. Values in seconds.'},
'tenvx': { 'Args': [ 'trig', 'atk', 'hold', 'rel' ], 'Outputs': 1 , 'Description': 'Exponential Envelope Generator. Values in seconds, hold > atk'},
'tgate': { 'Args': [ 'trigger', 'time' ], 'Outputs': 1 , 'Description': 'triggerable gate'},
'tget': { 'Args': [ 'index', 'table' ], 'Outputs': 1 , 'Description': 'Get value from table'},
'thresh': { 'Args': [ 'in', 'thresh', 'mode' ], 'Outputs': 1 , 'Description': 'detect threshold crossings. mode: 0=from below, 1=above, 2=both'},
'tick': { 'Args': [  ], 'Outputs': 1 , 'Description': 'trigger at start of file. only use once'},
'timer': { 'Args': [ 'trig' ], 'Outputs': 1 , 'Description': 'timer'},
'tog': { 'Args': [ 'trig' ], 'Outputs': 1 , 'Description': 'toggle switch that can be triggered on/off'},
'tone': { 'Args': [ 'in', 'cutoff' ], 'Outputs': 1 , 'Description': 'simple one-pole low pass filter'},
'tphasor': { 'Args': [ 'trig', 'freq', 'phase' ], 'Outputs': 1 , 'Description': 'Triggerable normalized sawtooth wave.'},
'tport': { 'Args': [ 'trig', 'htime' ], 'Outputs': 1 , 'Description': 'Applies portamento to a signal with triggerable reset.'},
'tprop': { 'Args': [ 'trig', 'bpm', 'code' ], 'Outputs': 1 , 'Description': 'prop with a triggerable reset'},
'trand': { 'Args': [ 'trig', 'min', 'max' ], 'Outputs': 1 , 'Description': 'triggerable RNG'},
'tseg': { 'Args': [ 'trig', 'val', 'dur', 'curve', 'init' ], 'Outputs': 1 , 'Description': 'trigger segment'},
'tseq': { 'Args': [ 'trig', 'mode', 'ft name' ], 'Outputs': 1 , 'Description': 'Triggered sequencer. modes: 0 = normal, 1 = shuffle.'},
'tset': { 'Args': [ 'index', 'value', 'table' ], 'Outputs': 1 , 'Description': 'Set value of table'},
'var': { 'Args': [ 'name' ], 'Outputs': 1 , 'Description': 'creates variable'},
'varset': { 'Args': [ 'name', 'val' ], 'Outputs': 1 , 'Description': 'creates and sets a variable'},
'vdelay': { 'Args': [ 'in', 'feedback', 'deltime', 'maxdelay' ], 'Outputs': 1 , 'Description': 'variable delay with feedback'},
'voc': { 'Args': [ 'freq', 'pos', 'diameter', 'tenseness', 'velum' ], 'Outputs': 1 , 'Description': 'Vocal Tract Physical Model'},
'vocoder': { 'Args': [ 'atk', 'rel', 'bwq', 'sig', 'exc' ], 'Outputs': 1 , 'Description': '32-band channel vocoder'},
'waveset': { 'Args': [ 'in', 'rep', 'buflen' ], 'Outputs': 1 , 'Description': 'waveset timestretching algorithm'},
'wpkorg35': { 'Args': [ 'in', 'cutoff', 'res', 'saturation' ], 'Outputs': 1 , 'Description': 'wpkorg filter'},
'zeros': { 'Args': [ 'name', 'size' ], 'Outputs': 1 , 'Description': 'Generate table of zeros'},
'zitarev': { 'Args': [ 'in2', 'in1', 'delay', 'lf_x', 'rtlo', 'rthi', 'hfdmp', 'eq1f', 'eq1l', 'eq2f', 'eq1l', 'mix', 'lvl' ], 'Outputs': 2 , 'Description': 'zitareverb module'},
'zrev': { 'Args': [ 'in2', 'in1', 'rtlo', 'rthi', 'hfdmp' ], 'Outputs': 1 , 'Description': 'zitareverb module (simplified)'}};
