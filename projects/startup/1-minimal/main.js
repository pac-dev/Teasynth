export const sampleRate = 44100;
let t = 0;
export const process = () => {
	// oscillator at 300Hz:
	let ret = Math.sin(t * 300 * Math.PI * 2);
	// modulation at 200Hz:
	ret *= Math.sin(t * 200 * Math.PI * 2);
	// polyrhythm:
	for (let i = 1; i < 6; i++) {
		ret *= Math.sqrt(1 + (-6 * t / i) % 1);
	}
	// distortion:
	ret = Math.tanh(ret * 5);
	t += 1 / sampleRate;
	return [ret, ret];
};
