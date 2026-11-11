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

async function getAllRepositories(path = `/users/${owner}/repos?type=owner`, options) {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const batch = await github(
      `${path}&sort=updated&per_page=100&page=${page}`,
      options,
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

async function updateLanguageChart(repositories, languageToken) {
  const privateOptions = { headers: { Authorization: `Bearer ${languageToken}` } };
  const privateRepositories = (
    await getAllRepositories("/user/repos?visibility=private&affiliation=owner", privateOptions)
  ).filter(
    (repository) =>
      repository.private && !repository.fork && !repository.archived && repository.owner.login === owner,
  );

  const languageCounts = await Promise.all(
    [...repositories, ...privateRepositories].map((repository) =>
      github(
        `/repos/${owner}/${encodeURIComponent(repository.name)}/languages`,
        repository.private ? privateOptions : undefined,
      ),
    ),
  );
  const totals = new Map();

  for (const counts of languageCounts) {
    for (const [language, bytes] of Object.entries(counts)) {
      if (bytes > 0) totals.set(language, (totals.get(language) || 0) + bytes);
    }
  }

  const ranked = [...totals].sort(
    ([nameA, bytesA], [nameB, bytesB]) => bytesB - bytesA || nameA.localeCompare(nameB, "en"),
  );
  await fs.writeFile("assets/languages.svg", buildLanguageSvg(ranked));
}

function buildLanguageSvg(ranked) {
  const total = ranked.reduce((sum, [, bytes]) => sum + bytes, 0);
  const colors = ["#f26155", "#f59343", "#f3bf57", "#db78ad", "#ffb597", "#ad86e6", "#a95360"];
  const languages = ranked.slice(0, colors.length);
  if (ranked.length > colors.length) {
    const otherBytes = ranked.slice(colors.length - 1).reduce((sum, [, bytes]) => sum + bytes, 0);
    languages[colors.length - 1] = ["Other", otherBytes];
  }

  const circumference = 2 * Math.PI * 76;
  let offset = 0;
  const segments = [];
  const legend = [];
  const description = [];

  for (const [index, [language, bytes]] of languages.entries()) {
    const share = bytes / total;
    const length = share * circumference;
    const percentage = `${(share * 100).toFixed(1)}%`;
    const color = colors[index];
    const y = 68 + index * 24;
    segments.push(`<circle cx="132" cy="144" r="76" stroke="${color}" stroke-dasharray="${length} ${circumference}" stroke-dashoffset="${-offset}" />`);
    offset += length;
    legend.push(`<circle cx="276" cy="${y}" r="5" fill="${color}" />
    <text x="292" y="${y}" dominant-baseline="middle">${escapeXml(language)}</text>
    <text x="588" y="${y}" dominant-baseline="middle" text-anchor="end" class="muted">${percentage}</text>`);
    description.push(`${language} ${percentage}`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="250" viewBox="0 0 620 250" role="img" aria-labelledby="title description">
  <title id="title">Languages</title>
  <desc id="description">${escapeXml(description.join(", ") || "No language data available.")}</desc>
  <style>
    text { font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #f0f6fc; font-variant-numeric: tabular-nums; }
    .muted { fill: #b3bac5; font-size: 13px; }
    .heading { font-size: 18px; font-weight: 600; }
    .top-language { font-weight: 600; }
  </style>
  <rect width="620" height="250" rx="12" fill="#161b22" />
  <text x="24" y="32" class="heading">Languages</text>
  <line x1="24" y1="45" x2="596" y2="45" stroke="#f59343" stroke-opacity=".45" />
  <circle cx="132" cy="144" r="76" fill="none" stroke="#30363d" stroke-width="25" />
  <g fill="none" stroke-width="25" transform="rotate(-90 132 144)">
    ${segments.join("\n    ")}
  </g>
  <text x="132" y="139" text-anchor="middle" class="muted">${total ? "Top language" : "No data"}</text>
  <text x="132" y="159" text-anchor="middle" class="top-language">${escapeXml(ranked[0]?.[0] || "")}</text>
  ${legend.join("\n    ")}
</svg>\n`;
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
  const languageToken = process.env.PROFILE_LANGUAGES_TOKEN;
  if (languageToken) {
    try {
      await updateLanguageChart(repositories, languageToken);
    } catch {
      console.warn("Could not refresh the language chart. Check PROFILE_LANGUAGES_TOKEN access.");
    }
  }
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
