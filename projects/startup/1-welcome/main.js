/**  ______                       __  __
 *  /_  __/__ ___ ____ __ _____  / /_/ /
 *   / / / -_) _ `(_-</ // / _ \/ __/ _ \
 *  /_/  \__/\_,_/___/\_, /_//_/\__/_//_/
 *                   /___/
 *     Audio Programming Environment
 *           Served from CLI
 */

// Example sound patch. A patch can impose its own samplerate:
export const sampleRate = 44100;
let t = 0;

// "process" is called once per audio frame:
export const process = () => {
	// Oscillator at 300Hz:
	let ret = Math.sin(t * 300 * Math.PI * 2);
	// Modulation at 200Hz:
	ret *= Math.sin(t * 200 * Math.PI * 2);
	// Polyrhythm:
	for (let i = 1; i < 6; i++) {
		ret *= Math.sqrt(1 + (-6 * t / i) % 1);
	}
	// Distortion:
	ret = Math.tanh(ret * 5);
	// Imprecise but simple way of counting time:
	t += 1 / sampleRate;
	return [ret, ret];
};
