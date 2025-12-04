# Upwork Jobs Scraper

Extract freelance job listings from Upwork with comprehensive details including job titles, descriptions, budgets, hourly rates, required skills, client information, and more.

## What does the Upwork Jobs Scraper do?

The Upwork Jobs Scraper enables you to automatically extract job postings from Upwork's freelance marketplace. Whether you're a freelancer looking for opportunities, conducting market research, or analyzing industry trends, this tool provides structured data from one of the world's largest freelancing platforms.

### Key features

- **Comprehensive job data extraction** - Get job titles, descriptions, budgets, hourly rates, and required skills
- **Client information** - Extract client ratings, reviews, total jobs posted, hire rates, and payment verification status
- **Smart filtering** - Search by keyword, job type, experience level, and location
- **Flexible pagination** - Control how many jobs and pages to scrape
- **Automated extraction** - No manual copying required

## Why scrape Upwork?

<ul>
  <li><strong>Find freelance opportunities</strong> - Discover jobs matching your skills and expertise</li>
  <li><strong>Market research</strong> - Analyze freelance market trends, pricing, and demand for specific skills</li>
  <li><strong>Competitive analysis</strong> - Study what skills and rates are in demand</li>
  <li><strong>Lead generation</strong> - Identify potential clients posting relevant projects</li>
  <li><strong>Skill gap analysis</strong> - Understand which skills are most sought after</li>
</ul>

## How much will it cost to scrape Upwork?

The cost depends on the number of jobs scraped and the complexity of the extraction. Here's an estimate:

- Scraping **100 jobs**: ~0.02-0.05 compute units (~$0.01-0.02)
- Scraping **500 jobs**: ~0.10-0.15 compute units (~$0.04-0.06)
- Scraping **1,000 jobs**: ~0.20-0.30 compute units (~$0.08-0.12)

The actor uses Playwright for browser automation to ensure reliable data extraction. Using Apify's residential proxies is recommended for optimal performance.

## Input configuration

### Basic setup

The scraper accepts the following input parameters:

<table>
  <thead>
    <tr>
      <th>Field</th>
      <th>Type</th>
      <th>Description</th>
      <th>Default</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>keyword</code></td>
      <td>String</td>
      <td>Search term for jobs (e.g., "web scraping", "python developer")</td>
      <td>"apify"</td>
    </tr>
    <tr>
      <td><code>results_wanted</code></td>
      <td>Integer</td>
      <td>Maximum number of jobs to extract</td>
      <td>100</td>
    </tr>
    <tr>
      <td><code>max_pages</code></td>
      <td>Integer</td>
      <td>Maximum number of pages to process</td>
      <td>20</td>
    </tr>
    <tr>
      <td><code>jobType</code></td>
      <td>String</td>
      <td>Filter by job type: "hourly" or "fixed"</td>
      <td>All types</td>
    </tr>
    <tr>
      <td><code>experienceLevel</code></td>
      <td>String</td>
      <td>Filter by level: "entry", "intermediate", or "expert"</td>
      <td>All levels</td>
    </tr>
    <tr>
      <td><code>location</code></td>
      <td>String</td>
      <td>Filter by client location</td>
      <td>-</td>
    </tr>
    <tr>
      <td><code>hourlyRateMin</code></td>
      <td>Integer</td>
      <td>Minimum hourly rate (USD)</td>
      <td>-</td>
    </tr>
    <tr>
      <td><code>hourlyRateMax</code></td>
      <td>Integer</td>
      <td>Maximum hourly rate (USD)</td>
      <td>-</td>
    </tr>
    <tr>
      <td><code>startUrl</code></td>
      <td>String</td>
      <td>Custom Upwork search URL (overrides other filters)</td>
      <td>-</td>
    </tr>
    <tr>
      <td><code>proxyConfiguration</code></td>
      <td>Object</td>
      <td>Proxy settings (residential proxies recommended)</td>
      <td>Apify Proxy</td>
    </tr>
  </tbody>
</table>

### Example input

```json
{
  "keyword": "data scraping",
  "results_wanted": 50,
  "max_pages": 5,
  "jobType": "hourly",
  "experienceLevel": "intermediate",
  "hourlyRateMin": 25,
  "hourlyRateMax": 75,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Output data

The scraper extracts the following information for each job:

<table>
  <thead>
    <tr>
      <th>Field</th>
      <th>Type</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>job_id</code></td>
      <td>String</td>
      <td>Unique job identifier</td>
    </tr>
    <tr>
      <td><code>title</code></td>
      <td>String</td>
      <td>Job title</td>
    </tr>
    <tr>
      <td><code>company</code></td>
      <td>String</td>
      <td>Client/company name</td>
    </tr>
    <tr>
      <td><code>description_text</code></td>
      <td>String</td>
      <td>Plain text job description</td>
    </tr>
    <tr>
      <td><code>description_html</code></td>
      <td>String</td>
      <td>HTML formatted description</td>
    </tr>
    <tr>
      <td><code>skills</code></td>
      <td>Array</td>
      <td>Required skills for the job</td>
    </tr>
    <tr>
      <td><code>location</code></td>
      <td>String</td>
      <td>Client location</td>
    </tr>
    <tr>
      <td><code>job_type</code></td>
      <td>String</td>
      <td>Contract type (hourly/fixed)</td>
    </tr>
    <tr>
      <td><code>experience_level</code></td>
      <td>String</td>
      <td>Required experience level</td>
    </tr>
    <tr>
      <td><code>budget</code></td>
      <td>String</td>
      <td>Fixed price budget (if applicable)</td>
    </tr>
    <tr>
      <td><code>hourly_rate</code></td>
      <td>String</td>
      <td>Hourly rate range (if applicable)</td>
    </tr>
    <tr>
      <td><code>duration</code></td>
      <td>String</td>
      <td>Project duration</td>
    </tr>
    <tr>
      <td><code>date_posted</code></td>
      <td>String</td>
      <td>When the job was posted</td>
    </tr>
    <tr>
      <td><code>proposals</code></td>
      <td>Number</td>
      <td>Number of proposals received</td>
    </tr>
    <tr>
      <td><code>client_rating</code></td>
      <td>Number</td>
      <td>Client's overall rating</td>
    </tr>
    <tr>
      <td><code>client_reviews</code></td>
      <td>Number</td>
      <td>Number of reviews</td>
    </tr>
    <tr>
      <td><code>client_jobs_posted</code></td>
      <td>Number</td>
      <td>Total jobs posted by client</td>
    </tr>
    <tr>
      <td><code>client_hire_rate</code></td>
      <td>Number</td>
      <td>Client's hire rate</td>
    </tr>
    <tr>
      <td><code>payment_verified</code></td>
      <td>Boolean</td>
      <td>Whether client's payment is verified</td>
    </tr>
    <tr>
      <td><code>url</code></td>
      <td>String</td>
      <td>Direct link to the job posting</td>
    </tr>
  </tbody>
</table>

### Example output

```json
{
  "job_id": "~01abc123def456",
  "title": "Web Scraping Expert Needed for E-commerce Data",
  "company": "Tech Solutions Inc.",
  "description_text": "We need an experienced web scraper to extract product data from multiple e-commerce websites...",
  "description_html": "<p>We need an experienced web scraper...</p>",
  "skills": ["Web Scraping", "Python", "Data Mining", "BeautifulSoup", "Selenium"],
  "location": "United States",
  "job_type": "Hourly",
  "experience_level": "Intermediate",
  "budget": null,
  "hourly_rate": "$30-$60",
  "duration": "1 to 3 months",
  "date_posted": "2025-12-04T10:30:00Z",
  "proposals": 15,
  "client_rating": 4.8,
  "client_reviews": 42,
  "client_jobs_posted": 87,
  "client_hire_rate": 85,
  "client_location": "United States",
  "payment_verified": true,
  "url": "https://www.upwork.com/jobs/~01abc123def456"
}
```

## How to use the Upwork Jobs Scraper

### Quick start

1. **Create a free Apify account** - [Sign up here](https://apify.com/sign-up)
2. **Open the Upwork Jobs Scraper** in the Apify Console
3. **Configure your search** - Enter keywords and set filters
4. **Run the scraper** - Click "Start" and wait for results
5. **Download data** - Export as JSON, CSV, XML, Excel, or HTML

### Advanced usage

#### Search for specific skills

```json
{
  "keyword": "python scrapy beautifulsoup",
  "results_wanted": 100,
  "experienceLevel": "expert"
}
```

#### Find high-paying hourly jobs

```json
{
  "keyword": "machine learning",
  "jobType": "hourly",
  "hourlyRateMin": 75,
  "hourlyRateMax": 150,
  "results_wanted": 50
}
```

#### Target specific client locations

```json
{
  "keyword": "mobile app development",
  "location": "United States",
  "results_wanted": 75
}
```

## Integration and export

The scraped data can be accessed through:

- **Apify API** - Integrate directly into your applications
- **Webhooks** - Get notified when scraping completes
- **Scheduled runs** - Automate daily/weekly scraping
- **Export formats** - JSON, CSV, Excel, XML, RSS, HTML

### API access example

```javascript
const ApifyClient = require('apify-client');

const client = new ApifyClient({
    token: 'YOUR_API_TOKEN',
});

const run = await client.actor('YOUR_USERNAME/upwork-jobs-scraper').call({
    keyword: 'web development',
    results_wanted: 100,
});

const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(items);
```

## Best practices

<ul>
  <li><strong>Use specific keywords</strong> - More specific searches yield better results</li>
  <li><strong>Enable proxies</strong> - Use residential proxies for reliable scraping</li>
  <li><strong>Set reasonable limits</strong> - Start with smaller result counts for testing</li>
  <li><strong>Schedule regular runs</strong> - Keep your data fresh with scheduled scraping</li>
  <li><strong>Respect rate limits</strong> - Use appropriate concurrency settings</li>
</ul>

## Troubleshooting

<dl>
  <dt><strong>No results returned</strong></dt>
  <dd>Ensure your search keywords match actual Upwork job postings. Try broader terms.</dd>
  
  <dt><strong>Incomplete data</strong></dt>
  <dd>Some fields may be missing if not provided by the client. This is normal behavior.</dd>
  
  <dt><strong>Scraper timing out</strong></dt>
  <dd>Reduce the number of results or pages to scrape. Large scraping jobs may need multiple runs.</dd>
  
  <dt><strong>Blocked requests</strong></dt>
  <dd>Enable residential proxies in the proxy configuration settings.</dd>
</dl>

## Limitations

- The scraper extracts publicly visible job information only
- Some job details may require Upwork account access
- Rate limiting may apply during high-volume scraping
- Job postings are subject to Upwork's availability

## Privacy and compliance

This scraper only extracts publicly available data from Upwork. Users are responsible for ensuring their use complies with:

- Upwork's Terms of Service
- Applicable data protection regulations (GDPR, CCPA, etc.)
- Intended use case requirements

## Need help?

If you encounter any issues or have questions:

- Check the [Apify documentation](https://docs.apify.com)
- Visit the [Apify community forum](https://community.apify.com)
- Contact support through the Apify Console

## Related scrapers

Looking for more job scraping solutions? Check out these related actors:

- **LinkedIn Jobs Scraper** - Extract jobs from LinkedIn
- **Indeed Jobs Scraper** - Scrape Indeed job listings
- **Glassdoor Scraper** - Get salary data and company reviews
- **Remote Jobs Scraper** - Find remote work opportunities

---

## Open source

This scraper is built with the Apify SDK and Playwright. Contributions and feedback are welcome!
