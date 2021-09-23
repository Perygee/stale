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

  // Get up to 500 open issues
  const issues = (
    await Promise.all(
      new Array(5).fill(0).map(
        async (_, page) =>
          (
            await octokit.rest.issues.listForRepo({
              ...opts,
              state: "open",
              per_page: 100,
              page,
            })
          ).data
      )
    )
  ).flat();

  const cardsInIgnoredColumns = (
    await Promise.all(
      ignoredColumns
        .split(",")
        .filter((c) => !!c)
        .map(async (column_id) =>
          // Get up to 200 unarchived cards in the column
          (
            await Promise.all(
              new Array(2).fill(0).map(async (_, page) =>
                (
                  await octokit.rest.projects.listCards({
                    column_id: parseInt(column_id, 10),
                    archived_state: "not_archived",
                    per_page: 100,
                    page,
                  })
                ).data.map((card) => card.content_url?.match(/\d+$/)?.[0])
              )
            )
          ).flat()
        )
    )
  ).flat();

  console.log("Ignoring the following cards:", cardsInIgnoredColumns);

  const filteredIssues = issues.filter(
    (i) => !cardsInIgnoredColumns.includes(i.number.toString())
  );

  await Promise.all(
    filteredIssues.map(async (issue) => {
      // Check when the issue was last updated
      const updatedAt = new Date(issue.updated_at);
      if (calculateDays(updatedAt) > daysStale) {
        // If the updated date is too far in the past, also check for
        // a recent event (like someone moving the column of the
        // issue)
        const issueEvents = await octokit.rest.issues.listEvents({
          owner: context.repo.owner,
          repo: context.repo.repo,
          per_page: 1,
          issue_number: issue.number,
        });
        const latestEventDate = issueEvents.data[0].created_at;
        if (
          latestEventDate &&
          calculateDays(new Date(latestEventDate)) > daysStale
        ) {
          console.log(
            `Bumping #${issue.number} which was last updated ${issue.updated_at} and had an event on ${latestEventDate}.`
          );
          octokit.rest.issues.createComment({
            ...opts,
            issue_number: issue.number,
            body: `Looks like issue #${
              issue.number
            } is stale as of ${new Date().toDateString()}. Have a great day!`,
          });
        }
      }
    })
  );
};

run();
