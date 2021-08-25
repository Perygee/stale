import * as core from "@actions/core";
import * as github from "@actions/github";

const run = async () => {
  const token = core.getInput("token");
  const daysStale = parseInt(core.getInput("days-stale"), 10);
  const onlyWeekdays = core.getInput("only-weekdays") === "true";
  const ignoredColumns = core.getInput("ignore-columns");
  const octokit = github.getOctokit(token);
  const context = github.context;

  const now = new Date();

  const calculateDays = (d: Date): number => {
    if (!onlyWeekdays) {
      return Math.round(
        Math.abs((d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      );
    }

    let numWorkDays = 0;
    let currentDate = new Date(d);
    while (currentDate <= now) {
      // Skips Sunday and Saturday
      if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
        numWorkDays++;
      }
      currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
    }
    return numWorkDays;
  };

  const opts = {
    owner: context.repo.owner,
    repo: context.repo.repo,
  };

  const issues = await octokit.rest.issues.listForRepo({
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: "open",
    per_page: 100,
    direction: "asc",
  });

  const cardsInIgnoredColumns = (
    await Promise.all(
      ignoredColumns.split(",").map(async (column_id) => {
        const cards = await octokit.rest.projects.listCards({
          column_id: parseInt(column_id, 10),
          archived_state: "not_archived",
          per_page: 100,
        });
        return cards.data.map((card) => card.content_url?.match(/\d+$/)?.[0]);
      })
    )
  ).flat();

  console.log("Ignoring the following cards:", cardsInIgnoredColumns);

  const filteredIssues = issues.data.filter(
    (i) => !cardsInIgnoredColumns.includes(i.number.toString())
  );

  filteredIssues.forEach((issue) => {
    const updatedAt = new Date(issue.updated_at);
    if (calculateDays(updatedAt) > daysStale) {
      console.log(
        `Bumping #${issue.number} which was last updated ${issue.updated_at}.`
      );
      octokit.rest.issues.createComment({
        ...opts,
        issue_number: issue.number,
        body: `Looks like this has gone stale. Have a great day!`,
      });
    }
  });
};

run();
