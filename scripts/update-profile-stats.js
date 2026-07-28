const fs = require("node:fs/promises");

const owner = process.env.GITHUB_USERNAME || "tnlong311";
const token = process.env.GITHUB_TOKEN;
const apiVersion = "2026-03-10";

if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

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
    const body = await response.text();
    throw new Error(`${response.status} ${path}: ${body}`);
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
          totalCommitContributions
          contributionCalendar {
            totalContributions
          }
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

  const collection = response.data.user.contributionsCollection;
  return {
    totalCommitContributions: collection.totalCommitContributions,
    totalContributions: collection.contributionCalendar.totalContributions,
  };
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${response.status} ${path}: ${body}`);
    }

    const contributors = await response.json();
    return contributors.find((contributor) => contributor.author?.login === owner) || null;
  }

  return null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

const valueColumn = 58;

function replaceStat(readme, label, value) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  const pattern = new RegExp(`^(\\s*\\. ${escapedLabel}:).*?$`, "m");
  if (!pattern.test(readme)) throw new Error(`README label not found: ${label}`);

  const visibleValue = value.replace(/<[^>]+>/g, "");
  const prefix = `$1`;
  const prefixLength = `. ${label}:`.length;
  const dotCount = Math.max(
    3,
    valueColumn - prefixLength - visibleValue.length - 2,
  );

  return readme.replace(pattern, `${prefix} ${".".repeat(dotCount)} ${value}`);
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
  let readme = await fs.readFile("README.md", "utf8");
  readme = replaceStat(readme, "Repos", formatNumber(repositories.length));
  readme = replaceStat(readme, "Commits", formatNumber(commits));
  readme = replaceStat(
    readme,
    "Contributions.Annual",
    formatNumber(contributions.totalContributions),
  );
  readme = replaceStat(
    readme,
    "Lines of Code",
    `<span style="color:#2da44e">${formatNumber(additions)}+++</span> / <span style="color:#cf222e">${formatNumber(deletions)}---</span>`,
  );

  await fs.writeFile("README.md", readme);
  console.log(
    JSON.stringify(
      {
        repositories: repositories.length,
        commits,
        contributions: contributions.totalContributions,
        additions,
        deletions,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
