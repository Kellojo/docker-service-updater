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

// Get changed files in the current commit
function getChangedFiles() {
  try {
    // Get files changed in the last commit
    const output = execSync("git diff --name-only HEAD~1 HEAD", {
      encoding: "utf8",
    });
    return output
      .trim()
      .split("\n")
      .filter((file) => file.length > 0);
  } catch (error) {
    core.warning(`Failed to get changed files: ${error.message}`);
    return [];
  }
}
