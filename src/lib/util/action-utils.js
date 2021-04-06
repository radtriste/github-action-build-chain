const core = require("@actions/core");

function getDefinitionFile() {
  return core.getInput("definition-file");
}

function getStartingProject() {
  console.log("getStartingProject", core.getInput("starting-project"));
  return core.getInput("starting-project");
}

function getFlowType() {
  return core.getInput("flow-type");
}

function isPullRequestFlowType() {
  return getFlowType() === "pull-request";
}

function isFDFlowType() {
  return getFlowType() === "full-downstream";
}

function isSingleFlowType() {
  return getFlowType() === "single";
}

module.exports = {
  getDefinitionFile,
  getStartingProject,
  getFlowType,
  isPullRequestFlowType,
  isFDFlowType,
  isSingleFlowType
};
