export const loadScript = url => new Promise((resolve, reject) => {
	const scriptEle = document.createElement('script');
	scriptEle.src = url;
	document.body.appendChild(scriptEle);
	scriptEle.addEventListener('load', resolve);
});