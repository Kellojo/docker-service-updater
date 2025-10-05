const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

core.info("Starting Docker service updater...");

const serviceName = core.getInput("service-name", { required: true });
const configPath = core.getInput("config-dir", { required: true });

core.info(`🔧 Service Name: ${serviceName}`);
core.info(`📁 Config Path: ${configPath}`);
core.info("");

if (!fs.existsSync(configPath)) {
  core.setFailed(`❌ Config directory does not exist: ${configPath}`);
  process.exit(1);
}

const serviceConfig = path.join(configPath, serviceName);
if (!fs.existsSync(serviceConfig)) {
  core.setFailed(
    `❌ Service configuration directory does not exist: ${serviceConfig}`
  );
  process.exit(1);
}

core.info(`✅ Found configuration directory for service: ${serviceConfig}`);

const changedFiles = getChangedFiles();
core.info(`📝 Changed files in current commit:`);
changedFiles.forEach((file) => core.info(` - ${file}`));

// Get changed files from GitHub event or git diff
function getChangedFiles() {
  // First, try to use GitHub event data (most reliable)
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));

      // For push events
      if (event.commits && Array.isArray(event.commits)) {
        const allChangedFiles = new Set();
        event.commits.forEach((commit) => {
          if (commit.added)
            commit.added.forEach((file) => allChangedFiles.add(file));
          if (commit.modified)
            commit.modified.forEach((file) => allChangedFiles.add(file));
          if (commit.removed)
            commit.removed.forEach((file) => allChangedFiles.add(file));
        });
        if (allChangedFiles.size > 0) {
          core.info("Using GitHub event data for changed files");
          return Array.from(allChangedFiles);
        }
      }

      // For pull request events
      if (event.pull_request) {
        core.info("Pull request detected, using git diff with base branch");
        const baseSha = event.pull_request.base.sha;
        const headSha = event.pull_request.head.sha;
        try {
          const output = execSync(
            `git diff --name-only ${baseSha}...${headSha}`,
            {
              encoding: "utf8",
            }
          );
          return output
            .trim()
            .split("\n")
            .filter((file) => file.length > 0);
        } catch (prError) {
          core.warning(`PR diff failed: ${prError.message}`);
        }
      }
    } catch (eventError) {
      core.warning(`Failed to parse GitHub event: ${eventError.message}`);
    }
  }

  // Fallback to git commands
  try {
    // Try git diff with previous commit
    const output = execSync("git diff --name-only HEAD~1 HEAD", {
      encoding: "utf8",
    });
    return output
      .trim()
      .split("\n")
      .filter((file) => file.length > 0);
  } catch (diffError) {
    core.warning(`Git diff failed: ${diffError.message}`);

    // Last resort: try using GitHub environment variables
    const beforeSha = process.env.GITHUB_EVENT_BEFORE;
    const afterSha = process.env.GITHUB_SHA;

    if (
      beforeSha &&
      afterSha &&
      beforeSha !== "0000000000000000000000000000000000000000"
    ) {
      try {
        const output = execSync(
          `git diff --name-only ${beforeSha}..${afterSha}`,
          {
            encoding: "utf8",
          }
        );
        core.info("Using GitHub environment variables for diff");
        return output
          .trim()
          .split("\n")
          .filter((file) => file.length > 0);
      } catch (envError) {
        core.warning(`Environment variable diff failed: ${envError.message}`);
      }
    }

    core.warning("All methods failed, returning empty array");
    return [];
  }
}
