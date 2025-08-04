#!/usr/bin/env node
/**
 * Written with Claude 4.5 Sonnet
 */
require('dotenv').config();
const { Octokit } = require('@octokit/rest');
const plot = require('simple-ascii-chart').default;
const { execSync } = require('child_process');

const octokit = new Octokit({ auth: process.env.TOKEN });

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

          const allText = comments.map(c => c.body).join(' ').replace(/[`'"\\$]/g, ' ');
          let sentimentScore = 0;

          if (comments.length > 0 && allText.trim().length > 50) {
            try {
              sentimentScore = parseFloat(execSync('python3 sentiment.py', {input: allText, encoding: 'utf8'}).trim());
              console.log(`\n📊 Day ${parseInt(issue.title.match(/\d+/)[0])} sentiment: ${sentimentScore.toFixed(3)}`);
            } catch (error) {
              console.log(`\n❌ Day ${parseInt(issue.title.match(/\d+/)[0])} sentiment analysis failed`);
            }
          }

          return {
            day: parseInt(issue.title.match(/\d+/)[0]),
            title: issue.title.replace(/^Day \d+:\s*/, ''),
            url: issue.html_url,
            commentCount: comments.length,
            createdAt: new Date(issue.created_at),
            commentTimes: comments.map(c => new Date(c.created_at)),
            sentiment: sentimentScore
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
          message: '🤖 Update README with latest data',
          content: Buffer.from(content).toString('base64'),
          sha: file.sha
        });
      } catch (error) {
        if (error.status === 404) {
          await octokit.rest.repos.createOrUpdateFileContents({
            owner: 'open-making',
            repo: 'web2025-dev-notes',
            path: 'README.md',
            message: '🤖 Create README with data',
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

  // Convert to IST for timestamp
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istTime = new Date(now.getTime() + istOffset);
  return `# Web 2025 Dev Notes

This repo documents our learning journey for the [web2025](https://teaching.aman.bh/web2025) course taught at DA-IICT.

- Course Website: https://teaching.aman.bh/web2025
- Facilitator: [@thedivtagguy](https://github.com/thedivtagguy)


## Entries

${entryList}


## Distribution of night owls

Graphing the time when notes have been added. ${generateNightOwlChart(entries)}

## How are we feeling?

Notes are positive, negative, or neutral?

${generateSentimentChart(entries)}
---

<span style="font-size: 12px;">This README is automatically updated when new comments are added to day-wise journal entries. It was updated on ${istTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${istTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} IST</span>
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
      // Convert UTC to IST (UTC + 5:30)
      const utcHour = t.getUTCHours();
      const utcMinute = t.getUTCMinutes();
      const istTotalMinutes = (utcHour * 60 + utcMinute + 330) % (24 * 60); // Add 5:30 hours
      const istHour = Math.floor(istTotalMinutes / 60);
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

  // Generate sleep verdict based on late night activity
  const lateNightCount = blocks[0].count; // 00-05 block
  const lateNightPercentage = Math.round((lateNightCount / times.length) * 100);
  let verdict;
  if (lateNightPercentage > 40) {
    verdict = "😴 Consider getting more sleep! Too many late night posts.";
  } else if (lateNightPercentage > 20) {
    verdict = "⚠️ Some night owls detected. More sleep please!";
  } else {
    verdict = "✅ Good sleep scenes, not many late night posts!";
  }

  return `${verdict}\n\n\`\`\`\n${chart}\n\`\`\`\n📊 ${times.length} total comments • Peak: ${peak.label.replace(/🌙|🌅|☀️|🌆/g, '').trim()}`;
}

function generateSentimentChart(entries) {
  const entriesWithComments = entries.filter(e => e.commentCount > 0);
  if (!entriesWithComments.length) return '```\n📊 No sentiment data yet! Add some comments first.\n```';

  // Create a map of day -> sentiment (only for days with comments)
  const sentimentMap = new Map();
  entriesWithComments.forEach(entry => {
    sentimentMap.set(entry.day, entry.sentiment);
  });

  // Find the complete range - from Day 1 to the highest existing day
  const existingDayNumbers = entries.map(e => e.day).sort((a, b) => a - b);
  const minDay = 1; // Always start from Day 1
  const maxDay = existingDayNumbers[existingDayNumbers.length - 1];

  // Create COMPLETE plot data - no gaps allowed!
  // We need sequential data points for the ASCII chart to draw continuous lines
  const plotData = [];

  // First, let's create an array of all sentiment values (with interpolation)
  const allSentiments = [];

  for (let day = minDay; day <= maxDay; day++) {
    if (sentimentMap.has(day)) {
      // We have sentiment data for this day
      allSentiments.push(sentimentMap.get(day));
    } else {
      // This day either has no issue, or has no comments - interpolate
      const prevDay = findPreviousDataPoint(sentimentMap, day);
      const nextDay = findNextDataPoint(sentimentMap, day);

      if (prevDay !== null && nextDay !== null) {
        // Linear interpolation between two known points
        const prevSentiment = sentimentMap.get(prevDay);
        const nextSentiment = sentimentMap.get(nextDay);
        const ratio = (day - prevDay) / (nextDay - prevDay);
        const interpolated = prevSentiment + ratio * (nextSentiment - prevSentiment);
        allSentiments.push(interpolated);
      } else if (prevDay !== null) {
        // Use previous value (extend forward)
        allSentiments.push(sentimentMap.get(prevDay));
      } else if (nextDay !== null) {
        // Use next value (extend backward)
        allSentiments.push(sentimentMap.get(nextDay));
      } else {
        // No data points available, use neutral
        allSentiments.push(0);
      }
    }
  }

  // Use raw sentiment data without smoothing to avoid trend exaggeration
  for (let i = 0; i < allSentiments.length; i++) {
    plotData.push([i + 1, allSentiments[i]]);
  }

  const asciiChart = plot(plotData, {
    width: 60,
    height: 10,
    axisCenter: [1, 0],
    hideYAxis: true,
    xLabel: 'Day',
    formatter: (x) => typeof x === 'number' ? x.toFixed(0) : x
  });

  return `\`\`\`\n😊 Positive\n${asciiChart}\n😕 Negative\n\`\`\`\n`;
}

function findPreviousDataPoint(sentimentMap, day) {
  for (let d = day - 1; d >= 1; d--) {
    if (sentimentMap.has(d)) return d;
  }
  return null;
}

function findNextDataPoint(sentimentMap, day, maxDay) {
  for (let d = day + 1; d <= maxDay; d++) { // Use maxDay
    if (sentimentMap.has(d)) return d;
  }
  return null;
}

updateReadme();