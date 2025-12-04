// Upwork Jobs Scraper - Production-ready with Cloudflare bypass
import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = 'web scraping',
            location = '',
            jobType = '',
            experienceLevel = '',
            hourlyRateMin = null,
            hourlyRateMax = null,
            results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 20,
            startUrl,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 100;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 20;

        // Build search URL with proper encoding
        const buildStartUrl = (kw) => {
            const u = new URL('https://www.upwork.com/nx/search/jobs/');
            if (kw) u.searchParams.set('q', String(kw).trim());
            return u.href;
        };

        const initialUrl = startUrl || buildStartUrl(keyword);
        
        // Configure proxy with residential IPs for Cloudflare bypass
        const proxyConf = await Actor.createProxyConfiguration(proxyConfiguration || {
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
            apifyProxyCountry: 'US',
        });

        let saved = 0;
        const seenJobs = new Set();

        // Random delay helper for human-like behavior
        const randomDelay = (min = 1000, max = 3000) => {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        };

        // Human-like mouse movement simulation
        const simulateHumanBehavior = async (page) => {
            try {
                // Random mouse movements
                const viewport = page.viewportSize();
                if (viewport) {
                    for (let i = 0; i < 3; i++) {
                        const x = Math.floor(Math.random() * viewport.width);
                        const y = Math.floor(Math.random() * viewport.height);
                        await page.mouse.move(x, y, { steps: 10 });
                        await page.waitForTimeout(randomDelay(200, 500));
                    }
                }
                
                // Random scroll
                await page.evaluate(() => {
                    const scrollAmount = Math.floor(Math.random() * 500) + 200;
                    window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                });
                await page.waitForTimeout(randomDelay(500, 1500));
            } catch (e) {
                // Ignore simulation errors
            }
        };

        // Extract job data from various formats
        const extractJobData = (jobNode) => {
            try {
                const title = jobNode.title || jobNode.jobTitle || null;
                const jobId = jobNode.ciphertext || jobNode.id || jobNode.uid || null;
                const url = jobId ? `https://www.upwork.com/jobs/${jobId}` : null;
                
                let budget = null;
                let hourlyRate = null;
                
                if (jobNode.amount?.amount) {
                    budget = `$${jobNode.amount.amount}`;
                } else if (jobNode.budget) {
                    budget = typeof jobNode.budget === 'object' ? `$${jobNode.budget.amount}` : jobNode.budget;
                }
                
                if (jobNode.hourlyBudgetMin || jobNode.hourlyBudgetMax) {
                    hourlyRate = `$${jobNode.hourlyBudgetMin || 0}-$${jobNode.hourlyBudgetMax || 0}/hr`;
                } else if (jobNode.hourlyBudgetText) {
                    hourlyRate = jobNode.hourlyBudgetText;
                }

                return {
                    job_id: jobId,
                    title: title,
                    company: jobNode.client?.companyName || jobNode.enterpriseName || 'Not specified',
                    description_text: jobNode.description || jobNode.snippet || null,
                    description_html: jobNode.description ? `<p>${jobNode.description}</p>` : null,
                    skills: (jobNode.skills || jobNode.attrs || []).map(s => 
                        typeof s === 'string' ? s : (s.prettyName || s.name || s)
                    ).filter(Boolean),
                    location: jobNode.client?.location?.country || jobNode.prefFreelancerLocation || 'Worldwide',
                    job_type: jobNode.type || jobNode.contractorTier || null,
                    experience_level: jobNode.tierText || jobNode.tier || jobNode.experienceLevel || null,
                    budget: budget,
                    hourly_rate: hourlyRate,
                    duration: jobNode.duration || jobNode.durationIdV3 || null,
                    date_posted: jobNode.createdOn || jobNode.publishedOn || jobNode.createdDateTime || null,
                    proposals: jobNode.totalApplicants || jobNode.proposalsTier || 0,
                    client_rating: jobNode.client?.totalFeedback || jobNode.totalFeedback || 0,
                    client_reviews: jobNode.client?.totalReviews || 0,
                    client_jobs_posted: jobNode.client?.totalPostedJobs || 0,
                    client_hire_rate: jobNode.client?.totalHires || 0,
                    client_location: jobNode.client?.location?.country || null,
                    client_spent: jobNode.client?.totalSpent?.amount || null,
                    payment_verified: jobNode.client?.paymentVerificationStatus === 1 || 
                                     jobNode.client?.verificationStatus === 1 || false,
                    url: url,
                    _source: 'upwork',
                };
            } catch (err) {
                log.warning(`Error extracting job data: ${err.message}`);
                return null;
            }
        };

        const crawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 5,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: {
                    maxUsageCount: 5,
                },
            },
            persistCookiesPerSession: true,
            maxConcurrency: 1, // Single concurrency for stealth
            navigationTimeoutSecs: 90,
            requestHandlerTimeoutSecs: 180,
            
            // Browser launch configuration for stealth
            launchContext: {
                launchOptions: {
                    headless: true,
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--disable-features=IsolateOrigins,site-per-process',
                        '--disable-site-isolation-trials',
                        '--disable-web-security',
                        '--disable-features=BlockInsecurePrivateNetworkRequests',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--window-size=1920,1080',
                    ],
                },
            },

            // Pre-navigation hook for stealth setup
            preNavigationHooks: [
                async ({ page, request }, gotoOptions) => {
                    // Set realistic viewport
                    await page.setViewportSize({ width: 1920, height: 1080 });
                    
                    // Override navigator properties to hide automation
                    await page.addInitScript(() => {
                        // Remove webdriver property
                        Object.defineProperty(navigator, 'webdriver', {
                            get: () => undefined,
                        });
                        
                        // Mock plugins
                        Object.defineProperty(navigator, 'plugins', {
                            get: () => [
                                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                                { name: 'Native Client', filename: 'internal-nacl-plugin' },
                            ],
                        });
                        
                        // Mock languages
                        Object.defineProperty(navigator, 'languages', {
                            get: () => ['en-US', 'en'],
                        });
                        
                        // Mock permissions
                        const originalQuery = window.navigator.permissions.query;
                        window.navigator.permissions.query = (parameters) => (
                            parameters.name === 'notifications' ?
                                Promise.resolve({ state: Notification.permission }) :
                                originalQuery(parameters)
                        );
                        
                        // Mock chrome runtime
                        window.chrome = {
                            runtime: {},
                            loadTimes: function() {},
                            csi: function() {},
                            app: {},
                        };
                        
                        // Override toString for functions
                        const oldCall = Function.prototype.call;
                        function call() {
                            return oldCall.apply(this, arguments);
                        }
                        Function.prototype.call = call;
                        
                        const nativeToStringFunctionString = Error.toString().replace(/Error/g, "toString");
                        const oldToString = Function.prototype.toString;
                        
                        function functionToString() {
                            if (this === window.navigator.permissions.query) {
                                return "function query() { [native code] }";
                            }
                            if (this === functionToString) {
                                return nativeToStringFunctionString;
                            }
                            return oldCall.call(oldToString, this);
                        }
                        Function.prototype.toString = functionToString;
                    });

                    // Set realistic headers
                    await page.setExtraHTTPHeaders({
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                        'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                        'Sec-Ch-Ua-Mobile': '?0',
                        'Sec-Ch-Ua-Platform': '"Windows"',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                    });

                    // Modify navigation options
                    gotoOptions.waitUntil = 'domcontentloaded';
                    gotoOptions.timeout = 90000;
                },
            ],

            // Post-navigation hook for Cloudflare challenge handling
            postNavigationHooks: [
                async ({ page, request }) => {
                    // Wait for potential Cloudflare challenge
                    const cloudflareDetected = await page.evaluate(() => {
                        return document.title.includes('Just a moment') || 
                               document.body?.innerText?.includes('Checking your browser') ||
                               document.querySelector('#challenge-running') !== null;
                    });

                    if (cloudflareDetected) {
                        log.info('Cloudflare challenge detected, waiting for resolution...');
                        
                        // Wait for challenge to complete (up to 30 seconds)
                        for (let i = 0; i < 30; i++) {
                            await page.waitForTimeout(1000);
                            
                            const stillChallenging = await page.evaluate(() => {
                                return document.title.includes('Just a moment') || 
                                       document.body?.innerText?.includes('Checking your browser');
                            });
                            
                            if (!stillChallenging) {
                                log.info('Cloudflare challenge passed!');
                                break;
                            }
                        }
                    }
                    
                    // Additional wait for page stability
                    await page.waitForTimeout(randomDelay(2000, 4000));
                },
            ],

            // Retry handling
            failedRequestHandler: async ({ request }, error) => {
                log.error(`Request ${request.url} failed: ${error.message}`);
            },

            async requestHandler({ page, request, session, crawler: crawlerInstance }) {
                const currentPage = request.userData?.page || 1;
                log.info(`Processing page ${currentPage}: ${request.url}`);

                // Check if we're blocked
                const pageTitle = await page.title();
                const pageContent = await page.content();
                
                if (pageTitle.includes('Access Denied') || 
                    pageTitle.includes('Blocked') ||
                    pageContent.includes('Access Denied') ||
                    pageContent.includes('Error 403')) {
                    
                    log.warning('Access denied detected, marking session as bad');
                    session?.markBad();
                    throw new Error('Access denied - IP blocked');
                }

                // Simulate human behavior
                await simulateHumanBehavior(page);

                // Wait for content to load
                try {
                    await page.waitForSelector('article, [data-test="job-tile"], section[class*="job"]', { 
                        timeout: 30000 
                    });
                } catch (e) {
                    log.warning('Job tiles not found with primary selector, trying alternatives...');
                }

                // Scroll to load all jobs
                await page.evaluate(async () => {
                    for (let i = 0; i < 5; i++) {
                        window.scrollBy({ top: 500, behavior: 'smooth' });
                        await new Promise(r => setTimeout(r, 500));
                    }
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                });
                
                await page.waitForTimeout(randomDelay(2000, 4000));

                let jobs = [];

                // Method 1: Extract from page scripts (most reliable)
                const scriptData = await page.evaluate(() => {
                    const scripts = document.querySelectorAll('script');
                    for (const script of scripts) {
                        const content = script.textContent || '';
                        if (content.includes('searchResults') || content.includes('jobSearchResults')) {
                            try {
                                // Try to find JSON data in script
                                const jsonMatch = content.match(/\{[\s\S]*"searchResults"[\s\S]*\}/);
                                if (jsonMatch) {
                                    return jsonMatch[0];
                                }
                            } catch (e) {}
                        }
                    }
                    
                    // Try window objects
                    const win = window;
                    if (win.__INITIAL_DATA__) return JSON.stringify(win.__INITIAL_DATA__);
                    if (win.__NEXT_DATA__) return JSON.stringify(win.__NEXT_DATA__);
                    if (win.__NUXT__) return JSON.stringify(win.__NUXT__);
                    
                    return null;
                });

                if (scriptData) {
                    try {
                        const parsed = JSON.parse(scriptData);
                        const searchResults = parsed.searchResults?.jobs || 
                                            parsed.props?.pageProps?.jobs ||
                                            parsed.data?.jobs || 
                                            [];
                        if (searchResults.length > 0) {
                            jobs = searchResults;
                            log.info(`Found ${jobs.length} jobs from script data`);
                        }
                    } catch (e) {
                        log.warning('Failed to parse script data');
                    }
                }

                // Method 2: HTML parsing
                if (jobs.length === 0) {
                    log.info('Using HTML parsing method...');
                    
                    jobs = await page.evaluate(() => {
                        const results = [];
                        
                        // Try multiple selectors
                        const selectors = [
                            'article[data-test="JobTile"]',
                            '[data-test="job-tile"]',
                            'article.job-tile',
                            'section[class*="job-tile"]',
                            '[class*="JobSearchCard"]',
                            'article',
                        ];
                        
                        let jobCards = [];
                        for (const selector of selectors) {
                            jobCards = document.querySelectorAll(selector);
                            if (jobCards.length > 0) break;
                        }
                        
                        jobCards.forEach((card, index) => {
                            try {
                                // Title
                                const titleEl = card.querySelector(
                                    'h2 a, h3 a, [data-test="job-title"], ' +
                                    '[class*="job-title"], a[class*="title"]'
                                );
                                const title = titleEl?.textContent?.trim();
                                
                                // URL and ID
                                const linkEl = card.querySelector('a[href*="/jobs/"]') || titleEl;
                                const href = linkEl?.getAttribute('href') || '';
                                const jobIdMatch = href.match(/~([a-f0-9]+)/i) || href.match(/\/jobs\/([^/?]+)/);
                                const jobId = jobIdMatch ? jobIdMatch[1] : `job-${index}`;
                                
                                // Description
                                const descEl = card.querySelector(
                                    '[data-test="job-description"], [class*="description"], ' +
                                    'p[class*="text"], span[class*="description"]'
                                );
                                const description = descEl?.textContent?.trim()?.substring(0, 500);
                                
                                // Budget/Rate
                                const budgetEl = card.querySelector(
                                    '[data-test="budget"], [class*="budget"], ' +
                                    '[data-test="is-fixed-price"], [class*="rate"]'
                                );
                                const budget = budgetEl?.textContent?.trim();
                                
                                // Skills
                                const skillEls = card.querySelectorAll(
                                    '[data-test="token"], [class*="skill"], ' +
                                    'span[class*="tag"], a[class*="skill"]'
                                );
                                const skills = Array.from(skillEls)
                                    .map(el => el.textContent?.trim())
                                    .filter(Boolean)
                                    .slice(0, 10);
                                
                                // Experience level
                                const expEl = card.querySelector(
                                    '[class*="experience"], [data-test="experience"]'
                                );
                                const experience = expEl?.textContent?.trim();
                                
                                // Posted time
                                const timeEl = card.querySelector(
                                    'time, [class*="posted"], [data-test="posted-on"]'
                                );
                                const postedTime = timeEl?.textContent?.trim() || 
                                                  timeEl?.getAttribute('datetime');
                                
                                // Client info
                                const clientEl = card.querySelector(
                                    '[class*="client"], [data-test="client"]'
                                );
                                const clientInfo = clientEl?.textContent?.trim();
                                
                                // Proposals
                                const proposalEl = card.querySelector(
                                    '[class*="proposal"], [data-test="proposals"]'
                                );
                                const proposals = proposalEl?.textContent?.match(/\d+/)?.[0] || '0';
                                
                                if (title) {
                                    results.push({
                                        id: jobId,
                                        ciphertext: jobId.startsWith('~') ? jobId : `~${jobId}`,
                                        title: title,
                                        description: description,
                                        budget: budget,
                                        skills: skills.map(s => ({ prettyName: s })),
                                        experienceLevel: experience,
                                        createdOn: postedTime,
                                        totalApplicants: parseInt(proposals) || 0,
                                        client: {
                                            info: clientInfo,
                                        },
                                    });
                                }
                            } catch (e) {
                                // Skip this card on error
                            }
                        });
                        
                        return results;
                    });
                    
                    log.info(`Found ${jobs.length} jobs from HTML parsing`);
                }

                // Process and save jobs
                for (const jobNode of jobs) {
                    if (saved >= RESULTS_WANTED) break;
                    
                    const item = extractJobData(jobNode);
                    if (!item) continue;
                    
                    const uniqueKey = item.job_id || item.title;
                    if (seenJobs.has(uniqueKey)) continue;
                    seenJobs.add(uniqueKey);

                    await Dataset.pushData(item);
                    saved++;
                    log.info(`Saved job ${saved}/${RESULTS_WANTED}: ${item.title?.substring(0, 50)}...`);
                }

                // Mark session as good if we got results
                if (jobs.length > 0) {
                    session?.markGood();
                }

                // Pagination
                if (saved < RESULTS_WANTED && currentPage < MAX_PAGES) {
                    // Try to find and click next page
                    const hasNextPage = await page.evaluate(() => {
                        const nextBtn = document.querySelector(
                            'button[aria-label="Next"], [data-test="pagination-next"], ' +
                            'a[aria-label="Next"], button:has-text("Next")'
                        );
                        return nextBtn && !nextBtn.disabled && nextBtn.offsetParent !== null;
                    });

                    if (hasNextPage) {
                        const nextPageUrl = new URL(request.url);
                        nextPageUrl.searchParams.set('page', String(currentPage + 1));
                        
                        await crawlerInstance.addRequests([{
                            url: nextPageUrl.href,
                            userData: { page: currentPage + 1 },
                        }]);
                        
                        log.info(`Enqueued page ${currentPage + 1}`);
                        
                        // Random delay before next page
                        await page.waitForTimeout(randomDelay(3000, 6000));
                    } else {
                        log.info('No more pages available');
                    }
                }
            },
        });

        log.info(`Starting scrape for: ${initialUrl}`);
        log.info(`Target: ${RESULTS_WANTED} jobs, max ${MAX_PAGES} pages`);
        
        await crawler.run([{ url: initialUrl, userData: { page: 1 } }]);
        
        log.info(`Scraping completed. Total jobs saved: ${saved}`);
        
        if (saved === 0) {
            log.warning('No jobs were scraped. This might indicate the scraper is being blocked.');
            log.warning('Try using residential proxies or reducing request frequency.');
        }
        
    } catch (error) {
        log.error(`Fatal error: ${error.message}`);
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
