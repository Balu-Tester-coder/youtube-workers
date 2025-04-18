//latest
import puppeteer from '@cloudflare/puppeteer';

export class PuppeteerSession11 {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.browser = null;
		this.page = null;
		this.lastUsedTime = Date.now();
		this.initializing = false;
		this.keepBrowserAlive();
	}

	async keepBrowserAlive() {
		setInterval(async () => {
			console.log('🟢 Keep-alive check at', new Date().toISOString());

			if (!this.browser || !this.page || this.page.isClosed()) {
				console.warn('⚠️ Browser or page is closed! Restarting...');
				await this.initializeBrowser();
			}

			this.lastUsedTime = Date.now();
			await this.state.storage.put('keep-alive', this.lastUsedTime);

			// Simulate activity to prevent Cloudflare eviction
			if (this.page) {
				await this.page.evaluate(() => console.log('🔄 Keep-alive event'));
			}
		}, 20000); // Every 20 seconds
	}

	async initializeBrowser() {
		if (this.browser) return; // Already running

		if (this.initializing) {
			while (!this.browser) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			return;
		}

		this.initializing = true;
		try {
			console.log('🚀 Launching Puppeteer...');
			this.browser = await puppeteer.launch(this.env.MYBROWSER);
			this.page = await this.browser.newPage();
			await this.page.setViewport({ width: 1280, height: 720 });

			// Simulate activity to prevent eviction
			setInterval(async () => {
				if (this.page) {
					await this.page.evaluate(() => console.log('👀 Page still active'));
				}
			}, 15000);

			this.lastUsedTime = Date.now();
		} catch (error) {
			console.error('❌ Puppeteer failed to start:', error);
		} finally {
			this.initializing = false;
		}
	}

	async loadPage(url) {
		if (!this.browser) await this.initializeBrowser();

		if (!this.page || this.page.isClosed()) {
			console.warn('⚠️ Page is closed, creating a new one...');
			this.page = await this.browser.newPage();
			await this.page.setViewport({ width: 1280, height: 720 });
		}

		const currentUrl = this.page.url();
		if (currentUrl !== url) {
			console.log(`📌 Navigating to ${url}`);
			await this.page.goto(url, { waitUntil: 'domcontentloaded' });
			await this.page.waitForTimeout(2000);
		}
		this.lastUsedTime = Date.now();
	}

	async fetch(request) {
		const { searchParams } = new URL(request.url);
		let url = searchParams.get('url');
		if (!url) {
			return new Response('Please add an ?url=https://example.com/ parameter', { status: 400 });
		}

		await this.initializeBrowser();
		await this.loadPage(url);

		const iframeElement = await this.page.$('iframe');
		if (!iframeElement) return new Response('No iframe found', { status: 404 });

		const iframe = await iframeElement.contentFrame();
		if (!iframe) return new Response('Could not access iframe', { status: 500 });

		const videoElement = await iframe.$('video');
		if (!videoElement) return new Response('No video found', { status: 404 });

		const isPlaying = await iframe.evaluate((video) => !video.paused && video.readyState === 4, videoElement);
		if (!isPlaying) {
			await videoElement.click();
			await iframe.evaluate((video) => video.play(), videoElement);
			await iframe.waitForFunction((video) => video.currentTime > 0, {}, videoElement);
		}

		let img = await iframe.evaluate(async (video) => {
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const ctx = canvas.getContext('2d');
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			return canvas.toDataURL('image/jpeg').split(',')[1];
		}, videoElement);

		let buffer = Buffer.from(img, 'base64');

		this.lastUsedTime = Date.now();

		return new Response(buffer, { headers: { 'content-type': 'image/jpeg' } });
	}
}

// Register Durable Object in module format
export default {
	async fetch(request, env) {
		let url = new URL(request.url);
		let pathComponents = url.pathname.split('/').filter(Boolean); // Split and remove empty parts
		let lastPathComponent = pathComponents.length > 0 ? pathComponents[pathComponents.length - 1] : '';
		let name = 'puppeteer-session' + lastPathComponent;
		let id = env.PUPPETEER_SESSIONS11.idFromName(name);
		let stub = env.PUPPETEER_SESSIONS11.get(id);
		return stub.fetch(request);
	},
};
