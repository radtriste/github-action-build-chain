const { ClientError, logger } = require("./common");
const { clone } = require("./git");

const URL_REGEXP = /^https:\/\/github.com\/([^/]+)\/([^/]+)\/(pull|tree)\/([^ ]+)$/;

async function executeLocally(context, url) {
  const { octokit } = context;

  const m = url.match(URL_REGEXP);
  if (m && m[3] === "pull") {
    logger.debug("Getting PR data...");
    const { data: pull_request } = await octokit.pulls.get({
      owner: m[1],
      repo: m[2],
      pull_number: m[4]
    });

    const event = {
      action: "opened",
      pull_request
    };

    await executeGitHubAction(context, "pull_request", event);
  } else if (m && m[3] === "tree") {
    const event = {
      ref: `refs/heads/${m[4]}`,
      repository: {
        name: m[2],
        owner: {
          name: m[1]
        }
      }
    };

    await executeGitHubAction(context, "push", event);
  } else {
    throw new ClientError(`invalid URL: ${url}`);
  }
}

async function executeGitHubAction(context, eventName, eventData) {
  logger.info("Event name:", eventName);
  // TODO: to implement it properly
  if (context['config'] && context['config']['parentDependencies']) {
    context['config']['parentDependencies'].forEach(async (project) => {
      let dir = project.replace(/ /g, '_').replace('-', '_'); // TODO: to properly replace
      let targetBranch = 'master'; // TODO: to get proper branch
      console.log('Checking out', project, targetBranch);
      await clone(`https://github.com/kiegroup/${project}`, dir, targetBranch);
      console.log('Building parent..', project);
    });
  }
  if (context['config'] && context['config']['childDependencies']) {
    context['config']['childDependencies'].forEach(async (project) => {
      let dir = project.replace(/ /g, '_').replace('-', '_'); // TODO: to properly replace
      let targetBranch = 'master'; // TODO: to get proper branch
      console.log('Checking out', project, targetBranch);
      await clone(`https://github.com/kiegroup/${project}`, dir, targetBranch);
      console.log('Building parent..', project);
    });
  }

  logger.info("Context:", context['config']);
  logger.trace("Event data:", eventData);
}

module.exports = { executeLocally, executeGitHubAction };