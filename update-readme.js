#!/usr/bin/env node
/**
 * Written with Claude 4.5 Sonnet
 */
require('dotenv').config();
const { Octokit } = require('@octokit/rest');
const Sentiment = require('sentiment');
const plot = require('simple-ascii-chart').default;

const octokit = new Octokit({ auth: process.env.TOKEN });
const sentiment = new Sentiment();

if (!process.env.TOKEN) {
  console.error('❌ TOKEN environment variable is required');
  process.exit(1);
}

async function updateReadme() {
  try {
    const { data: issues } = await octokit.rest.issues.listForRepo({ 
      owner: 'open-making', 
      repo: 'web2025-dev-notes', 
      state: 'all', 
      per_page: 100 
    });
    
    const dayEntries = await Promise.all(
      issues
        .filter(issue => /^Day \d+:/.test(issue.title))
        .sort((a, b) => parseInt(a.title.match(/\d+/)[0]) - parseInt(b.title.match(/\d+/)[0]))
        .map(async (issue) => {
          const { data: comments } = await octokit.rest.issues.listComments({ 
            owner: 'open-making', 
            repo: 'web2025-dev-notes', 
            issue_number: issue.number 
          });
          
          const allText = comments.map(c => c.body).join(' ');
          return {
            day: parseInt(issue.title.match(/\d+/)[0]),
            title: issue.title.replace(/^Day \d+:\s*/, ''),
            url: issue.html_url,
            commentCount: comments.length,
            createdAt: new Date(issue.created_at),
            commentTimes: comments.map(c => new Date(c.created_at)),
            sentiment: comments.length > 0 ? sentiment.analyze(allText).comparative : 0
          };
        })
    );

    const content = generateReadme(dayEntries);
    
    if (process.env.LOCAL_MODE === 'true') {
      require('fs').writeFileSync('README.md', content);
    } else {
      try {
        const { data: file } = await octokit.rest.repos.getContent({ 
          owner: 'open-making', 
          repo: 'web2025-dev-notes', 
          path: 'README.md' 
        });
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: 'open-making', 
          repo: 'web2025-dev-notes', 
          path: 'README.md',
          message: '🤖 Update README with latest dev notes index',
          content: Buffer.from(content).toString('base64'),
          sha: file.sha
        });
      } catch (error) {
        if (error.status === 404) {
          await octokit.rest.repos.createOrUpdateFileContents({
            owner: 'open-making', 
            repo: 'web2025-dev-notes', 
            path: 'README.md',
            message: '🤖 Create README with dev notes index',
            content: Buffer.from(content).toString('base64')
          });
        } else throw error;
      }
    }

    console.log(`✅ README updated successfully!\n📊 Indexed ${dayEntries.length} day entries`);
  } catch (error) {
    console.error('❌ Error updating README:', error.message);
    process.exit(1);
  }
}

function generateReadme(entries) {
  const entryList = entries.map(e => 
    `- [Day ${e.day} (${e.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}): ${e.title}](${e.url}) | ${e.commentCount} notes`
  ).join('\n');

  const now = new Date();
  return `# Web 2025 Dev Notes

This repo documents our learning journey for the [web2025](https://teaching.aman.bh/web2025) course taught at DA-IICT.

- Course Website: https://teaching.aman.bh/web2025
- Facilitator: [@thedivtagguy](https://github.com/thedivtagguy)


## Entries

${entryList}


## Distribution of night owls

Graphing the time when notes have been added.

${generateNightOwlChart(entries)}

## How are we feeling?

Notes are positive, negative, or neutral?

${generateSentimentChart(entries)}

---

<span style="font-size: 12px;">This README is automatically updated when new comments are added to day-wise journal entries. It was updated on ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
`;
}

function generateNightOwlChart(entries) {
  const times = entries.flatMap(e => e.commentTimes);
  if (!times.length) return '```\n🦉 No night owls yet! Be the first to post.\n```';

  const blocks = [
    { label: '🌙 00-05', hours: [0,1,2,3,4,5] },
    { label: '🌅 06-11', hours: [6,7,8,9,10,11] },
    { label: '☀️ 12-17', hours: [12,13,14,15,16,17] },
    { label: '🌆 18-23', hours: [18,19,20,21,22,23] }
  ].map(block => ({
    ...block,
    count: times.filter(t => {
      const istHour = Math.floor((t.getHours() + 5.5) % 24);
      return block.hours.includes(istHour);
    }).length
  }));

  const maxCount = Math.max(...blocks.map(b => b.count));
  const chart = blocks.map(b => {
    const barLength = Math.round((b.count / maxCount) * 20);
    const bar = '▓'.repeat(barLength) + '░'.repeat(20 - barLength);
    const percentage = Math.round((b.count / times.length) * 100);
    return `${b.label} │${bar}│ ${b.count.toString().padStart(2)} (${percentage}%)`;
  }).join('\n');

  const peak = blocks.reduce((max, curr) => curr.count > max.count ? curr : max);
  return `\`\`\`\n${chart}\n\`\`\`\n📊 ${times.length} total comments • Peak: ${peak.label.replace(/🌙|🌅|☀️|🌆/g, '').trim()}`;
}

function generateSentimentChart(entries) {
  const entriesWithComments = entries.filter(e => e.commentCount > 0);
  if (!entriesWithComments.length) return '```\n📊 No sentiment data yet! Add some comments first.\n```';

  const plotData = entriesWithComments.map((entry, index) => [index + 1, entry.sentiment]);
  const asciiChart = plot(plotData, {
    width: 50,
    height: 10,
    axisCenter: [1, 0],
    hideYAxis: true,
    xLabel: 'Day',
    formatter: (x) => typeof x === 'number' ? x.toFixed(0) : x
  });

  return `\`\`\`\n😊 Positive\n${asciiChart}\n😕 Negative\n\`\`\`\n`;
}

updateReadme();