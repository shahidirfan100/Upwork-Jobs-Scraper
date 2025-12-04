// Upwork jobs scraper - Playwright + API interception implementation
import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '',
            location = '',
            jobType = '',
            experienceLevel = '',
            hourlyRateMin = null,
            hourlyRateMax = null,
            results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 20,
            collectDetails = true,
            startUrl,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 100;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 20;

        const buildStartUrl = (kw) => {
            const u = new URL('https://www.upwork.com/nx/search/jobs/');
            if (kw) u.searchParams.set('q', String(kw).trim());
            return u.href;
        };

        const initialUrl = startUrl || buildStartUrl(keyword);
        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;
        let pageNum = 0;
        const seenJobs = new Set();

        const cleanText = (html) => {
            if (!html) return '';
            return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        };

        const extractJobData = (jobNode) => {
            try {
                const title = jobNode.title || null;
                const jobId = jobNode.ciphertext || jobNode.id || null;
                const url = jobId ? `https://www.upwork.com/jobs/${jobId}` : null;
                
                // Extract budget/payment info
                let budget = null;
                let hourlyRate = null;
                if (jobNode.amount) {
                    budget = jobNode.amount.amount ? `$${jobNode.amount.amount}` : null;
                }
                if (jobNode.hourlyBudgetMin || jobNode.hourlyBudgetMax) {
                    hourlyRate = `$${jobNode.hourlyBudgetMin || 0}-$${jobNode.hourlyBudgetMax || 0}`;
                }

                const item = {
                    job_id: jobId,
                    title: title,
                    company: jobNode.client?.companyName || 'Not specified',
                    description_text: jobNode.description || null,
                    description_html: jobNode.description ? `<p>${jobNode.description}</p>` : null,
                    skills: jobNode.skills?.map(s => s.prettyName || s.name).filter(Boolean) || [],
                    location: jobNode.client?.location?.country || 'Worldwide',
                    job_type: jobNode.contractorTier || jobNode.jobType || null,
                    experience_level: jobNode.tierText || jobNode.tier || null,
                    budget: budget,
                    hourly_rate: hourlyRate,
                    duration: jobNode.duration || null,
                    date_posted: jobNode.createdDateTime || jobNode.publishedOn || null,
                    proposals: jobNode.proposalsTier || jobNode.totalApplicants || 0,
                    client_rating: jobNode.client?.totalFeedback || 0,
                    client_reviews: jobNode.client?.totalReviews || 0,
                    client_jobs_posted: jobNode.client?.totalPostedJobs || 0,
                    client_hire_rate: jobNode.client?.totalHires || 0,
                    client_location: jobNode.client?.location?.country || null,
                    payment_verified: jobNode.client?.verificationStatus === 1 || false,
                    url: url,
                };

                return item;
            } catch (err) {
                log.error(`Error extracting job data: ${err.message}`);
                return null;
            }
        };

        const crawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 120,
            launchContext: {
                launchOptions: {
                    headless: true,
                },
            },
            async requestHandler({ page, request, enqueueLinks }) {
                const currentPage = request.userData?.page || 1;
                log.info(`Processing page ${currentPage}: ${request.url}`);

                // Wait for the page to load
                await page.waitForTimeout(3000);

                // Method 1: Try to intercept API calls
                let apiData = null;
                
                page.on('response', async (response) => {
                    const url = response.url();
                    if (url.includes('api.upwork.com') || url.includes('/api/') || url.includes('search')) {
                        try {
                            const contentType = response.headers()['content-type'];
                            if (contentType && contentType.includes('application/json')) {
                                const data = await response.json();
                                if (data.searchResults || data.jobs || data.results) {
                                    apiData = data;
                                    log.info('Found API data from network interception');
                                }
                            }
                        } catch (e) {
                            // Ignore parsing errors
                        }
                    }
                });

                // Scroll to load lazy content
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await page.waitForTimeout(2000);

                // Method 2: Extract from Redux store or window object
                const extractedData = await page.evaluate(() => {
                    try {
                        // Try to find Redux store
                        const reduxStore = window.__REDUX_STATE__ || window.__INITIAL_STATE__ || window.__NEXT_DATA__;
                        if (reduxStore) {
                            return JSON.stringify(reduxStore);
                        }

                        // Try to find job data in various window objects
                        const possibleKeys = Object.keys(window).filter(key => 
                            key.includes('search') || key.includes('jobs') || key.includes('data')
                        );
                        
                        for (const key of possibleKeys) {
                            if (window[key] && typeof window[key] === 'object') {
                                return JSON.stringify(window[key]);
                            }
                        }

                        return null;
                    } catch (e) {
                        return null;
                    }
                });

                let jobs = [];

                // Process API data if found
                if (apiData) {
                    const jobsList = apiData.searchResults?.jobs || apiData.jobs || apiData.results || [];
                    jobs = jobsList;
                } else if (extractedData) {
                    try {
                        const parsed = JSON.parse(extractedData);
                        const jobsList = parsed.searchResults?.jobs || parsed.jobs || parsed.results || [];
                        jobs = jobsList;
                    } catch (e) {
                        log.warning('Failed to parse extracted data');
                    }
                }

                // Method 3: HTML parsing fallback
                if (!jobs || jobs.length === 0) {
                    log.info('Using HTML parsing fallback');
                    
                    const htmlJobs = await page.evaluate(() => {
                        const jobCards = Array.from(document.querySelectorAll('[data-test="job-tile"], article, [class*="job"], section[class*="JobTile"]'));
                        
                        return jobCards.map(card => {
                            const titleEl = card.querySelector('h2, h3, [class*="title"], [data-test="job-title"]');
                            const title = titleEl?.textContent?.trim() || null;
                            
                            const linkEl = card.querySelector('a[href*="/jobs/"]');
                            const href = linkEl?.getAttribute('href') || null;
                            const jobId = href ? href.match(/\/jobs\/~([a-f0-9]+)/)?.[1] : null;
                            
                            const descEl = card.querySelector('[class*="description"], p');
                            const description = descEl?.textContent?.trim() || null;
                            
                            const budgetEl = card.querySelector('[class*="budget"], [data-test="budget"]');
                            const budget = budgetEl?.textContent?.trim() || null;
                            
                            const skillsEls = card.querySelectorAll('[class*="skill"], [data-test="skill"]');
                            const skills = Array.from(skillsEls).map(el => el.textContent?.trim()).filter(Boolean);
                            
                            const locationEl = card.querySelector('[class*="location"], [data-test="location"]');
                            const location = locationEl?.textContent?.trim() || null;
                            
                            const dateEl = card.querySelector('[class*="posted"], time');
                            const datePosted = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || null;

                            return {
                                ciphertext: jobId,
                                title,
                                description,
                                skills: skills.map(s => ({ prettyName: s })),
                                amount: budget ? { amount: budget } : null,
                                client: {
                                    location: { country: location }
                                },
                                createdDateTime: datePosted,
                            };
                        }).filter(job => job.title);
                    });

                    jobs = htmlJobs;
                }

                log.info(`Found ${jobs.length} jobs on page ${currentPage}`);

                // Process jobs
                for (const jobNode of jobs) {
                    if (saved >= RESULTS_WANTED) break;
                    
                    const item = extractJobData(jobNode);
                    if (!item || !item.job_id) continue;

                    if (seenJobs.has(item.job_id)) continue;
                    seenJobs.add(item.job_id);

                    await Dataset.pushData(item);
                    saved++;
                    log.info(`Saved job ${saved}/${RESULTS_WANTED}: ${item.title}`);
                }

                // Pagination
                if (saved < RESULTS_WANTED && currentPage < MAX_PAGES) {
                    const nextPageExists = await page.evaluate(() => {
                        const nextBtn = document.querySelector('[aria-label="Next"], [data-test="next-page"], button[class*="next"]');
                        return nextBtn && !nextBtn.disabled;
                    });

                    if (nextPageExists) {
                        const currentUrl = new URL(request.url);
                        const offset = currentPage * 50; // Upwork typically shows 50 jobs per page
                        currentUrl.searchParams.set('page', String(currentPage + 1));
                        
                        await enqueueLinks({
                            urls: [currentUrl.href],
                            userData: { page: currentPage + 1 },
                        });
                        
                        log.info(`Enqueued page ${currentPage + 1}`);
                    } else {
                        log.info('No more pages available');
                    }
                }
            },
        });

        await crawler.run([{ url: initialUrl, userData: { page: 1 } }]);
        log.info(`Scraping completed. Total jobs saved: ${saved}`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
