import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { firefox } from 'playwright';
import * as cheerio from 'cheerio';

// Initialize the Apify SDK
await Actor.init();

/**
 * Strip HTML tags from string
 */
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract jobs from JSON-LD structured data
 */
async function extractJobsViaJsonLD(page) {
    log.info('Attempting to extract jobs via JSON-LD');

    try {
        const jsonLdScripts = await page.$$eval('script[type="application/ld+json"]', scripts =>
            scripts.map(script => script.textContent)
        );

        const jobs = [];

        for (const scriptContent of jsonLdScripts) {
            try {
                const data = JSON.parse(scriptContent);

                // Handle array of job postings
                if (Array.isArray(data)) {
                    for (const item of data) {
                        if (item['@type'] === 'JobPosting') {
                            jobs.push(parseJobPosting(item));
                        }
                    }
                }
                // Handle single job posting
                else if (data['@type'] === 'JobPosting') {
                    jobs.push(parseJobPosting(data));
                }
                // Handle @graph structure
                else if (data['@graph']) {
                    for (const item of data['@graph']) {
                        if (item['@type'] === 'JobPosting') {
                            jobs.push(parseJobPosting(item));
                        }
                    }
                }
                // Handle ItemList with job postings
                else if (data['@type'] === 'ItemList' && data.itemListElement) {
                    for (const listItem of data.itemListElement) {
                        const item = listItem.item || listItem;
                        if (item['@type'] === 'JobPosting') {
                            jobs.push(parseJobPosting(item));
                        }
                    }
                }
            } catch (parseErr) {
                log.debug(`Failed to parse JSON-LD: ${parseErr.message}`);
            }
        }

        if (jobs.length > 0) {
            log.info(`Extracted ${jobs.length} jobs via JSON-LD`);
        }

        return jobs;
    } catch (error) {
        log.warning(`JSON-LD extraction failed: ${error.message}`);
        return [];
    }
}

/**
 * Parse JobPosting schema to Upwork format
 */
function parseJobPosting(jobData) {
    const hiringOrg = jobData.hiringOrganization || {};

    return {
        title: jobData.title || '',
        description: stripHtml(jobData.description || ''),
        budget: jobData.baseSalary?.value?.toString() || 'Not specified',
        experienceLevel: jobData.experienceRequirements || 'Not specified',
        contractType: jobData.employmentType || 'Not specified',
        projectLength: 'Not specified',
        skills: [],
        postedDate: jobData.datePosted || '',
        clientInfo: hiringOrg.name || '',
        url: jobData.url || '',
        scrapedAt: new Date().toISOString()
    };
}

/**
 * Extract embedded JSON data from page (like __NEXT_DATA__ or window.__DATA__)
 */
async function extractJobsViaEmbeddedJSON(page) {
    log.info('Attempting to extract jobs via embedded JSON');

    try {
        const scripts = await page.$$eval('script:not([src])', scripts =>
            scripts.map(script => script.textContent || '')
        );

        const jobs = [];

        for (const content of scripts) {
            // Look for __NEXT_DATA__
            if (content.includes('__NEXT_DATA__')) {
                try {
                    const match = content.match(/__NEXT_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/);
                    if (match) {
                        const data = JSON.parse(match[1]);
                        const pageProps = data?.props?.pageProps;
                        if (pageProps?.jobs || pageProps?.listings) {
                            const jobArray = pageProps.jobs || pageProps.listings || [];
                            for (const job of jobArray) {
                                jobs.push(parseEmbeddedJob(job));
                            }
                        }
                    }
                } catch (e) {
                    log.debug('Failed to parse __NEXT_DATA__');
                }
            }

            // Look for window.__DATA__ or similar patterns
            const dataPatterns = [
                /window\.__DATA__\s*=\s*({[\s\S]*?});/,
                /window\.initialState\s*=\s*({[\s\S]*?});/,
                /"jobs"\s*:\s*\[[\s\S]*?\]/
            ];

            for (const pattern of dataPatterns) {
                try {
                    const match = content.match(pattern);
                    if (match) {
                        const jsonStr = match[0].includes('{') ? match[1] || match[0] : `{${match[0]}}`;
                        const data = JSON.parse(jsonStr);
                        const jobArray = data.jobs || data.listings || data.results || [];
                        if (Array.isArray(jobArray) && jobArray.length > 0) {
                            for (const job of jobArray) {
                                jobs.push(parseEmbeddedJob(job));
                            }
                        }
                    }
                } catch (e) {
                    // Continue trying other patterns
                }
            }
        }

        if (jobs.length > 0) {
            log.info(`Extracted ${jobs.length} jobs via embedded JSON`);
        }

        return jobs;
    } catch (error) {
        log.warning(`Embedded JSON extraction failed: ${error.message}`);
        return [];
    }
}

/**
 * Parse embedded job data to our format
 */
function parseEmbeddedJob(job) {
    return {
        title: job.title || job.jobTitle || job.name || '',
        description: stripHtml(job.description || job.snippet || ''),
        budget: job.budget || job.amount?.amount?.toString() || job.hourlyRate || 'Not specified',
        experienceLevel: job.experienceLevel || job.tierLabel || job.tier || 'Not specified',
        contractType: job.contractType || job.type || job.jobType || 'Not specified',
        projectLength: job.duration || job.projectLength || job.estimatedDuration || 'Not specified',
        skills: job.skills || job.tags || job.attributes || [],
        postedDate: job.publishedOn || job.createdOn || job.postedDate || '',
        clientInfo: job.client?.name || job.clientName || job.buyer?.name || '',
        url: job.url || job.ciphertext ? `https://www.upwork.com/jobs/${job.ciphertext}` : '',
        scrapedAt: new Date().toISOString()
    };
}

/**
 * Extract job data via HTML parsing with Cheerio (Primary method for Upwork)
 */
async function extractJobDataViaHTML(page) {
    log.info('Extracting job data via HTML parsing with Cheerio');

    try {
        const html = await page.content();
        const $ = cheerio.load(html);
        const jobs = [];

        // Upwork job card selectors - multiple fallback patterns
        const jobCardSelectors = [
            'article[data-test="JobTile"]',
            'article[data-ev-label="job_tile"]',
            'section[data-test="job-tile"]',
            '[data-test="job-tile-list"] > article',
            '.job-tile',
            '.up-card-section',
            'article.job-tile-upgrade',
            '[class*="job-tile"]'
        ];

        let jobElements = $([]);

        for (const selector of jobCardSelectors) {
            const elements = $(selector);
            if (elements.length > 0) {
                log.info(`Found ${elements.length} job cards with selector: ${selector}`);
                jobElements = elements;
                break;
            }
        }

        // If no specific selectors work, try broader patterns
        if (jobElements.length === 0) {
            log.info('Trying broader selectors for job cards');
            const broadSelectors = [
                'article',
                'section[class*="job"]',
                'div[class*="job-tile"]',
                'div[class*="JobTile"]'
            ];

            for (const selector of broadSelectors) {
                const elements = $(selector);
                if (elements.length > 0 && elements.length < 50) {
                    log.info(`Found ${elements.length} potential job cards with: ${selector}`);
                    jobElements = elements;
                    break;
                }
            }
        }

        jobElements.each((index, element) => {
            try {
                const $el = $(element);
                const job = extractUpworkJobFromElement($, $el);
                if (job && job.title) {
                    jobs.push(job);
                }
            } catch (err) {
                log.debug(`Error extracting job ${index}: ${err.message}`);
            }
        });

        log.info(`Extracted ${jobs.length} jobs via HTML parsing`);
        return jobs;

    } catch (error) {
        log.warning(`HTML parsing failed: ${error.message}`);
        return [];
    }
}

/**
 * Extract job data from a single Upwork job element
 */
function extractUpworkJobFromElement($, $el) {
    try {
        // Title selectors
        const titleSelectors = [
            '[data-test="job-tile-title"] a',
            'h2 a[data-test="job-tile-title-link"]',
            'h3 a[data-test="UpLink"]',
            '.job-tile-title a',
            'h2.job-title a',
            'h3.job-title a',
            '[class*="title"] a',
            'h2 a',
            'h3 a'
        ];

        let title = '';
        let url = '';

        for (const sel of titleSelectors) {
            const titleEl = $el.find(sel).first();
            if (titleEl.length && titleEl.text().trim()) {
                title = titleEl.text().trim();
                url = titleEl.attr('href') || '';
                if (url && !url.startsWith('http')) {
                    url = `https://www.upwork.com${url}`;
                }
                break;
            }
        }

        // Description selectors
        const descSelectors = [
            '[data-test="UpCLineClamp JobDescription"] p',
            '[data-test="job-description-text"] p',
            '.job-tile-description',
            '.job-description',
            '[class*="description"] p',
            '[class*="Description"] p',
            'p[class*="text-body"]'
        ];

        let description = '';
        for (const sel of descSelectors) {
            const descEl = $el.find(sel).first();
            if (descEl.length && descEl.text().trim().length > 20) {
                description = descEl.text().trim();
                break;
            }
        }

        // Budget/Rate selectors
        const budgetSelectors = [
            '[data-test="job-type-label"]',
            '[data-test="is-fixed-price"]',
            '[data-test="budget"]',
            '.job-tile-type-rate',
            '[class*="budget"]',
            '[class*="rate"]',
            '[class*="Budget"]',
            'strong[class*="money"]'
        ];

        let budget = 'Not specified';
        for (const sel of budgetSelectors) {
            const budgetEl = $el.find(sel).first();
            if (budgetEl.length && budgetEl.text().trim()) {
                budget = budgetEl.text().trim();
                break;
            }
        }

        // Experience level selectors
        const expSelectors = [
            '[data-test="experience-level"]',
            '[data-test="job-tier"]',
            '.job-tile-experience',
            '[class*="experience"]',
            '[class*="tier"]',
            '[class*="level"]'
        ];

        let experienceLevel = 'Not specified';
        for (const sel of expSelectors) {
            const expEl = $el.find(sel).first();
            if (expEl.length && expEl.text().trim()) {
                experienceLevel = expEl.text().trim();
                break;
            }
        }

        // Contract type (Fixed/Hourly)
        const contractSelectors = [
            '[data-test="payment-type"]',
            '[data-test="job-type"]',
            '.job-type',
            '[class*="type"]'
        ];

        let contractType = 'Not specified';
        for (const sel of contractSelectors) {
            const contractEl = $el.find(sel).first();
            const text = contractEl.text().trim().toLowerCase();
            if (text.includes('hourly') || text.includes('fixed')) {
                contractType = text.includes('hourly') ? 'Hourly' : 'Fixed-price';
                break;
            }
        }

        // Skills/Tags
        const skillsSelectors = [
            '[data-test="TokenClamp JobAttrs"] [data-test="token"]',
            '[data-test="Attr"] [data-test="Attrs"]',
            '.up-skill-badge',
            '.skill-badge',
            '[class*="skill"] span',
            '[class*="tag"] span',
            '[class*="token"] span'
        ];

        const skills = [];
        for (const sel of skillsSelectors) {
            const skillEls = $el.find(sel);
            if (skillEls.length > 0) {
                skillEls.each((_, skillEl) => {
                    const skillText = $(skillEl).text().trim();
                    if (skillText && skillText.length < 50) {
                        skills.push(skillText);
                    }
                });
                if (skills.length > 0) break;
            }
        }

        // Posted date
        const dateSelectors = [
            '[data-test="posted-on"]',
            '[data-test="job-posted-on"]',
            '.job-tile-posted',
            'time',
            '[class*="posted"]',
            '[class*="time"]',
            'small[class*="text-muted"]'
        ];

        let postedDate = '';
        for (const sel of dateSelectors) {
            const dateEl = $el.find(sel).first();
            if (dateEl.length && dateEl.text().trim()) {
                postedDate = dateEl.text().trim();
                break;
            }
        }

        // Project length
        const durationSelectors = [
            '[data-test="duration"]',
            '[data-test="estimated-duration"]',
            '.job-duration',
            '[class*="duration"]',
            '[class*="length"]'
        ];

        let projectLength = 'Not specified';
        for (const sel of durationSelectors) {
            const durEl = $el.find(sel).first();
            if (durEl.length && durEl.text().trim()) {
                projectLength = durEl.text().trim();
                break;
            }
        }

        // Client info
        const clientSelectors = [
            '[data-test="client-info"]',
            '[data-test="client-country"]',
            '.client-info',
            '[class*="client"]'
        ];

        let clientInfo = '';
        for (const sel of clientSelectors) {
            const clientEl = $el.find(sel).first();
            if (clientEl.length && clientEl.text().trim()) {
                clientInfo = clientEl.text().trim();
                break;
            }
        }

        // Only return if we have at least a title
        if (title) {
            return {
                title,
                description,
                budget,
                experienceLevel,
                contractType,
                projectLength,
                skills: skills.slice(0, 10), // Limit to 10 skills
                postedDate,
                clientInfo,
                url,
                scrapedAt: new Date().toISOString()
            };
        }

        return null;
    } catch (err) {
        log.debug(`Error extracting job from element: ${err.message}`);
        return null;
    }
}

/**
 * Debug: Save page HTML for analysis
 */
async function saveDebugInfo(page) {
    try {
        const html = await page.content();
        const $ = cheerio.load(html);

        log.warning('DEBUG: Page structure analysis', {
            articleCount: $('article').length,
            sectionCount: $('section').length,
            title: $('title').text(),
            hasCloudflare: html.includes('Just a moment') || html.includes('cf-browser')
        });

        await Actor.setValue('DEBUG_PAGE_HTML', html, { contentType: 'text/html' });
        log.info('Saved full page HTML to DEBUG_PAGE_HTML for analysis');

    } catch (error) {
        log.warning(`Failed to save debug info: ${error.message}`);
    }
}

/**
 * Main Actor execution
 */
try {
    const input = await Actor.getInput() || {};

    log.info('Starting Upwork Jobs Scraper', {
        searchUrl: input.searchUrl,
        maxJobs: input.maxJobs
    });

    // Validate input
    if (!input.searchUrl?.trim()) {
        throw new Error('Invalid input: "searchUrl" is required. Example: https://www.upwork.com/freelance-jobs/web-scraping/');
    }

    const maxJobs = input.maxJobs ?? 20;
    if (maxJobs < 0 || maxJobs > 10000) {
        throw new Error('maxJobs must be between 0 and 10000');
    }

    const searchUrl = input.searchUrl.trim();
    log.info(`Search URL: ${searchUrl}`);

    // Create proxy configuration
    const proxyConfiguration = await Actor.createProxyConfiguration(
        input.proxyConfiguration || { useApifyProxy: true }
    );

    // Statistics tracking
    let totalJobsScraped = 0;
    let pagesProcessed = 0;
    let extractionMethod = 'None';
    const startTime = Date.now();

    // Deduplication
    const seenJobUrls = new Set();

    // Get proxy URL for Camoufox
    const proxyUrl = await proxyConfiguration.newUrl();

    // Create Playwright crawler with Camoufox for Cloudflare bypass
    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxRequestsPerCrawl: 20,
        maxConcurrency: 3,
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 180,
        launchContext: {
            launcher: firefox,
            launchOptions: await camoufoxLaunchOptions({
                // Headless mode
                headless: true,

                // Proxy configuration
                proxy: proxyUrl,

                // GeoIP spoofing - critical for Cloudflare bypass
                geoip: true,

                // OS fingerprint - Windows is most common
                os: 'windows',

                // Locale settings
                locale: 'en-US',

                // Screen constraints for realistic viewport
                screen: {
                    minWidth: 1024,
                    maxWidth: 1920,
                    minHeight: 768,
                    maxHeight: 1080,
                },
            }),
        },

        async requestHandler({ page, request }) {
            pagesProcessed++;
            log.info(`Processing page ${pagesProcessed}: ${request.url}`);

            try {
                // Set realistic headers
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1',
                });

                // Navigate to page
                await page.goto(request.url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });

                // Wait for network idle
                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

                // Handle Cloudflare challenge
                let retryCount = 0;
                const maxRetries = 5;

                while (retryCount < maxRetries) {
                    const title = await page.title();
                    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');

                    if (title.includes('Just a moment') ||
                        title.includes('Cloudflare') ||
                        bodyText.includes('unusual traffic') ||
                        bodyText.includes('Checking your browser') ||
                        bodyText.includes('Verify you are human')) {

                        log.warning(`Cloudflare challenge detected (attempt ${retryCount + 1}/${maxRetries})`);

                        // Wait for challenge to resolve
                        await page.waitForTimeout(5000);

                        // Try to click Turnstile checkbox if present
                        try {
                            const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]');
                            const checkbox = turnstileFrame.locator('input[type="checkbox"], .cf-turnstile-wrapper');

                            if (await checkbox.count() > 0) {
                                log.info('Found Turnstile checkbox, attempting click...');
                                await checkbox.first().click({ timeout: 5000 });
                                await page.waitForTimeout(5000);
                            }
                        } catch (clickErr) {
                            log.debug('No clickable Turnstile element found');
                        }

                        await page.waitForTimeout(5000);
                        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });

                        retryCount++;
                    } else {
                        if (retryCount > 0) {
                            log.info('Cloudflare challenge bypassed successfully!');
                        }
                        break;
                    }
                }

                if (retryCount >= maxRetries) {
                    log.error('Failed to bypass Cloudflare after maximum retries');
                    await saveDebugInfo(page);
                    return;
                }

                // Additional wait for dynamic content
                await page.waitForTimeout(3000);

                let jobs = [];

                // Strategy 1: Try JSON-LD extraction first
                jobs = await extractJobsViaJsonLD(page);
                if (jobs.length > 0) {
                    extractionMethod = 'JSON-LD';
                    log.info(`✓ JSON-LD extraction successful: ${jobs.length} jobs`);
                }

                // Strategy 2: Try embedded JSON data
                if (jobs.length === 0) {
                    jobs = await extractJobsViaEmbeddedJSON(page);
                    if (jobs.length > 0) {
                        extractionMethod = 'Embedded JSON';
                        log.info(`✓ Embedded JSON extraction successful: ${jobs.length} jobs`);
                    }
                }

                // Strategy 3: Fall back to HTML parsing
                if (jobs.length === 0) {
                    jobs = await extractJobDataViaHTML(page);
                    if (jobs.length > 0) {
                        extractionMethod = 'HTML Parsing';
                        log.info(`✓ HTML parsing successful: ${jobs.length} jobs`);
                    }
                }

                // Save debug info if no jobs found
                if (jobs.length === 0) {
                    log.warning('No jobs found with any extraction method. Saving debug info...');
                    await saveDebugInfo(page);
                }

                if (jobs.length > 0) {
                    // Limit jobs if needed
                    let jobsToSave = maxJobs > 0
                        ? jobs.slice(0, Math.max(0, maxJobs - totalJobsScraped))
                        : jobs;

                    // Remove duplicates
                    const uniqueJobs = jobsToSave.filter(job => {
                        if (!job.url) return true;
                        if (seenJobUrls.has(job.url)) {
                            log.debug(`Skipping duplicate: ${job.title}`);
                            return false;
                        }
                        seenJobUrls.add(job.url);
                        return true;
                    });

                    if (uniqueJobs.length < jobsToSave.length) {
                        log.info(`Removed ${jobsToSave.length - uniqueJobs.length} duplicate jobs`);
                    }

                    jobsToSave = uniqueJobs;

                    // Save jobs
                    if (jobsToSave.length > 0) {
                        await Actor.pushData(jobsToSave);
                        totalJobsScraped += jobsToSave.length;
                        log.info(`Saved ${jobsToSave.length} jobs. Total: ${totalJobsScraped}`);
                    }

                    // Check if reached limit
                    if (maxJobs > 0 && totalJobsScraped >= maxJobs) {
                        log.info(`Reached maximum jobs limit: ${maxJobs}`);
                        return;
                    }

                    // Pagination - check for next page
                    const currentUrl = new URL(request.url);
                    const currentPage = parseInt(currentUrl.searchParams.get('page') || '1');

                    // Look for pagination controls
                    const hasNextPage = await page.evaluate(() => {
                        const nextBtn = document.querySelector('[data-test="pagination-next"]') ||
                            document.querySelector('button[aria-label="Next"]') ||
                            document.querySelector('.pagination-next') ||
                            document.querySelector('a[rel="next"]');
                        return nextBtn && !nextBtn.disabled;
                    });

                    if (hasNextPage && totalJobsScraped < maxJobs) {
                        const nextPage = currentPage + 1;
                        currentUrl.searchParams.set('page', nextPage.toString());
                        const nextPageUrl = currentUrl.toString();

                        log.info(`Found next page: ${nextPageUrl}`);
                        await crawler.addRequests([{
                            url: nextPageUrl,
                            uniqueKey: nextPageUrl
                        }]);
                    }
                }

            } catch (error) {
                log.error(`Error processing page: ${error.message}`, { url: request.url });
            }
        },

        async failedRequestHandler({ request }, error) {
            log.error(`Request failed: ${request.url} - ${error.message}`);
        }
    });

    // Start crawling
    log.info('Starting crawler with Camoufox for Cloudflare bypass...');
    await crawler.run([searchUrl]);

    // Calculate statistics
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    const statistics = {
        totalJobsScraped,
        pagesProcessed,
        extractionMethod,
        duration: `${duration} seconds`,
        timestamp: new Date().toISOString()
    };

    await Actor.setValue('statistics', statistics);

    log.info('✓ Scraping completed successfully!', statistics);

    if (totalJobsScraped > 0) {
        log.info(`Successfully scraped ${totalJobsScraped} jobs in ${duration} seconds`);
    } else {
        log.warning('No jobs were scraped. Upwork may be blocking requests. Check DEBUG_PAGE_HTML for details.');
    }

} catch (error) {
    log.exception(error, 'Actor failed with error');
    throw error;
}

// Exit successfully
await Actor.exit();
