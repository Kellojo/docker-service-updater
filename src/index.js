const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

core.info("Starting Docker service updater...");

const serviceName = core.getInput("service-name", { required: true });
const configPath = core.getInput("config-dir", { required: true });
const remoteProjectDir = core.getInput("remote-project-dir", {
  required: true,
});
const sshPassword = core.getInput("ssh-password", { required: true });
core.setSecret(sshPassword);
const sshHost = core.getInput("ssh-host", { required: true });
const sshUser = core.getInput("ssh-user", { required: true });
const sshPort = core.getInput("ssh-port", { required: true });

core.info(`🔧 Service Name: ${serviceName}`);
core.info(`📁 Config Path: ${configPath}`);
core.info(`🌍 Remote Project Directory: ${remoteProjectDir}`);
core.info(`🔑 SSH Details: ${sshUser}@${sshHost}:${sshPort}`);
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

core.info(`Found configuration directory for service: ${serviceConfig}`);

const changedFiles = getChangedFiles();
if (!changedFiles.some((file) => file.startsWith(serviceConfig))) {
  core.info(`ℹ️ No changes detected in ${serviceName} configuration. Exiting.`);
  process.exit(0);
}

core.info(
  `Changes detected in ${serviceName} configuration. Proceeding with update...`
);
core.info("");

// Copy configuration files to remote server via SSH
copyConfigFiles(serviceConfig, serviceName, sshPassword);

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

// Copy configuration files to remote server via SSH
function copyConfigFiles(serviceConfigPath, serviceName, sshPassword) {
  core.info(`📂 Copying configuration folder for ${serviceName}...`);

  try {
    // Check if service config directory exists and has files
    if (!fs.existsSync(serviceConfigPath)) {
      core.warning(
        `Service config directory does not exist: ${serviceConfigPath}`
      );
      return;
    }

    const files = getAllFiles(serviceConfigPath);
    if (files.length === 0) {
      core.warning(`No files found in ${serviceConfigPath}`);
      return;
    }

    core.info(`Found ${files.length} files in configuration folder`);

    // Copy the entire folder using scp -r (recursive)
    const remotePath = path.posix.join(
      remoteProjectDir,
      configPath,
      serviceName
    );

    try {
      // Use SSHPASS environment variable for better security and shell compatibility
      const scpCommand = `scp -r -o StrictHostKeyChecking=no -P ${sshPort} "${serviceConfigPath}/." ${sshUser}@${sshHost}:"${remotePath}/"`;

      core.info(
        `Executing: sshpass scp -r -o StrictHostKeyChecking=no -P ${sshPort} "${serviceConfigPath}/." ${sshUser}@${sshHost}:"${remotePath}/"`
      );

      execSync(`sshpass -e ${scpCommand}`, {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, SSHPASS: sshPassword },
      });

      core.info(
        `✅ Successfully copied configuration folder for ${serviceName}`
      );
    } catch (copyError) {
      core.setFailed(
        `❌ Failed to copy configuration folder: ${copyError.message}`
      );
      throw copyError;
    }
  } catch (error) {
    core.setFailed(`❌ Failed to copy configuration files: ${error.message}`);
    throw error;
  }
}

// Recursively get all files in a directory
function getAllFiles(dirPath) {
  const files = [];

  function traverse(currentPath) {
    const items = fs.readdirSync(currentPath);

    items.forEach((item) => {
      const itemPath = path.join(currentPath, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        traverse(itemPath);
      } else {
        files.push(itemPath);
      }
    });
  }

  traverse(dirPath);
  return files;
}
