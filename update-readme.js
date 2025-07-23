#!/usr/bin/env node
/**
 * Written with Claude 4.5 Sonnet
 *
 */
require('dotenv').config();
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.TOKEN });
const [owner, repo] = ['open-making', 'web2025-dev-notes'];

if (!process.env.TOKEN) {
  console.error('❌ TOKEN environment variable is required');
  process.exit(1);
}

async function updateReadme() {
  try {
    const { data: issues } = await octokit.rest.issues.listForRepo({ owner, repo, state: 'all', per_page: 100 });

    const dayEntries = await Promise.all(
      issues
        .filter(issue => /^Day \d+:/.test(issue.title))
        .sort((a, b) => parseInt(a.title.match(/\d+/)[0]) - parseInt(b.title.match(/\d+/)[0]))
        .map(async (issue) => {
          const { data: comments } = await octokit.rest.issues.listComments({ owner, repo, issue_number: issue.number });
          return {
            day: parseInt(issue.title.match(/\d+/)[0]),
            title: issue.title.replace(/^Day \d+:\s*/, ''),
            url: issue.html_url,
            commentCount: comments.length,
            createdAt: new Date(issue.created_at),
            commentTimes: comments.map(c => new Date(c.created_at))
          };
        })
    );

    const content = generateReadme(dayEntries);

    if (process.env.LOCAL_MODE === 'true') {
      require('fs').writeFileSync('README.md', content);
    } else {
      try {
        const { data: file } = await octokit.rest.repos.getContent({ owner, repo, path: 'README.md' });
        await octokit.rest.repos.createOrUpdateFileContents({
          owner, repo, path: 'README.md',
          message: '🤖 Update README with latest dev notes index',
          content: Buffer.from(content).toString('base64'),
          sha: file.sha
        });
      } catch (error) {
        if (error.status === 404) {
          await octokit.rest.repos.createOrUpdateFileContents({
            owner, repo, path: 'README.md',
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

  return `# Web 2025 Dev Notes

This repo documents our learning journey for the [web2025](https://teaching.aman.bh/web2025) course taught at DA-IICT.

- Course Website: https://teaching.aman.bh/web2025
- Facilitator: [@thedivtagguy](https://github.com/thedivtagguy)


## Entries

${entryList}


## Distribution of night owls

Graphing the time when notes have been added.

${generateChart(entries)}

_This README is automatically updated when new comments are added to day-wise journal entries._
`;
}

function generateChart(entries) {
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

updateReadme();