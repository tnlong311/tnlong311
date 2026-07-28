const fs = require("node:fs/promises");

const owner = process.env.GITHUB_USERNAME || "tnlong311";
const token = process.env.GITHUB_TOKEN;
const apiVersion = "2026-03-10";

if (!token) throw new Error("GITHUB_TOKEN is required");

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": apiVersion,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${await response.text()}`);
  }

  return response.json();
}

async function getAllRepositories() {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/users/${owner}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
    );
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

async function getContributionCount() {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { totalContributions }
        }
      }
    }
  `;

  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);

  const response = await github("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        login: owner,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });

  if (response.errors?.length) {
    throw new Error(response.errors.map((error) => error.message).join("; "));
  }

  return response.data.user.contributionsCollection.contributionCalendar
    .totalContributions;
}

async function getContributorStats(repository) {
  const path = `/repos/${owner}/${repository.name}/stats/contributors`;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": apiVersion,
      },
    });

    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`${response.status} ${path}`);

    const contributors = await response.json();
    return contributors.find((contributor) => contributor.author?.login === owner) || null;
  }

  return null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

const panelX = 704;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function row(y, label, value, color = "#f0f6fc") {
  const labelWidth = Math.min(420, 24 + label.length * 8.2);
  const dots = ".".repeat(Math.max(4, Math.floor((656 - labelWidth) / 8)));

  return [
    `<text x="${panelX + 24}" y="${y}" class="label">${escapeXml(label)}</text>`,
    `<text x="${panelX + labelWidth}" y="${y}" class="dots">${dots}</text>`,
    `<text x="${panelX + 656}" y="${y}" text-anchor="end" fill="${color}">${escapeXml(value)}</text>`,
  ].join("\n");
}

function heading(y, title) {
  return [
    `<text x="${panelX + 24}" y="${y}" class="heading">- ${escapeXml(title)}</text>`,
    `<line x1="${panelX + 36 + title.length * 8}" y1="${y - 5}" x2="${panelX + 656}" y2="${y - 5}" class="rule" />`,
  ].join("\n");
}

function buildSvg({ repositories, commits, contributions, additions, deletions, asciiDataUri }) {
  const linesAdded = formatNumber(additions);
  const linesRemoved = formatNumber(deletions);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1384" height="744" viewBox="0 0 1384 744">
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 15px; }
    .title { font-size: 18px; font-weight: 700; fill: #f0f6fc; }
    .label { fill: #f0f6fc; }
    .dots { fill: #7d8590; letter-spacing: 2px; }
    .heading { font-weight: 700; fill: #f0f6fc; }
    .rule { stroke: #7d8590; stroke-width: 1; }
  </style>
  <image href="${asciiDataUri}" x="0" y="0" width="680" height="744" preserveAspectRatio="xMidYMid meet" />
  <rect x="${panelX}" y="0" width="680" height="744" rx="12" fill="#161b22" />
  <text x="${panelX + 24}" y="40" class="title">long@github</text>
  <line x1="${panelX + 142}" y1="34" x2="${panelX + 656}" y2="34" class="rule" />
  ${row(82, "OS:", "Fullstack Engineer")}
  ${row(104, "Uptime:", "est. 2018")}
  ${row(126, "Host:", "Ho Chi Minh City, Vietnam")}
  ${row(148, "Domain:", "Fulbright University Vietnam")}
  ${row(204, "Languages.Programming:", "JavaScript, Python, Ruby")}
  ${row(226, "Languages.Cloud:", "AWS, Google Cloud Platform")}
  ${row(248, "Languages.Real:", "Vietnamese, English")}
  ${row(304, "Hobbies.Software:", "AI Products, SaaS, Backend Systems")}
  ${row(326, "Hobbies.Hardware:", "Frisbee, Gym, Origami")}
  ${heading(382, "Contact")}
  ${row(422, "Email.Work:", "longtn.work@gmail.com")}
  ${row(444, "GitHub:", "tnlong311")}
  ${heading(500, "GitHub Stats")}
  ${row(540, "Repos:", formatNumber(repositories))}
  ${row(562, "Commits:", formatNumber(commits))}
  ${row(584, "Contributions.Annual:", formatNumber(contributions))}
  <text x="${panelX + 24}" y="628" class="label">Lines of Code:</text>
  <text x="${panelX + 224}" y="628" class="dots">....................</text>
  <text x="${panelX + 656}" y="628" text-anchor="end">
    <tspan fill="#2da44e">${escapeXml(linesAdded)}+++</tspan>
    <tspan fill="#f0f6fc"> / </tspan>
    <tspan fill="#f85149">${escapeXml(linesRemoved)}---</tspan>
  </text>
</svg>`;
}

async function main() {
  const repositories = (await getAllRepositories()).filter(
    (repository) => !repository.fork && !repository.archived,
  );

  let commits = 0;
  let additions = 0;
  let deletions = 0;

  for (const repository of repositories) {
    const contributor = await getContributorStats(repository);
    if (!contributor) continue;

    commits += contributor.total || 0;
    for (const week of contributor.weeks || []) {
      additions += week.a || 0;
      deletions += week.d || 0;
    }
  }

  const contributions = await getContributionCount();
  const asciiData = await fs.readFile("assets/profile-ascii.png");
  const svg = buildSvg({
    repositories: repositories.length,
    commits,
    contributions,
    additions,
    deletions,
    asciiDataUri: `data:image/png;base64,${asciiData.toString("base64")}`,
  });

  await fs.writeFile("assets/profile-card.svg", svg);
  console.log(JSON.stringify({
    repositories: repositories.length,
    commits,
    contributions,
    additions,
    deletions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
