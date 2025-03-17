import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { JSDOM } from "jsdom";
import { execSync } from "child_process";
import inquirer from "inquirer";
import xmlFormatter from "xml-formatter";
import { fileURLToPath } from "url";

const prompt = inquirer.createPromptModule();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const constraintsDir = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "validations",
  "constraints"
);
const testDir = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "validations",
  "constraints",
  "unit-tests"
);
const featureFile = path.join(
  __dirname,
  "..",
  "..",
  "features",
  "fedramp_extensions.feature"
);
const ignoreDocument = "oscal-external-constraints.xml";

async function getAllConstraints() {
  const files = fs
    .readdirSync(constraintsDir)
    .filter((file) => file.endsWith(".xml") && file !== ignoreDocument);
  let allContext = {};

  for (const file of files) {
    const filePath = path.join(constraintsDir, file);
    const xmlContent = fs.readFileSync(filePath, "utf8");
    const dom = new JSDOM(xmlContent, { contentType: "text/xml" });
    const document = dom.window.document;

    // Select all elements with an 'id' attribute
    const constraintElements = document.querySelectorAll("[id]");

    constraintElements.forEach((constraintElement) => {
      const id = constraintElement.getAttribute("id");

      // Find the parent 'context' element
      let contextElement = constraintElement.closest("context");

      if (contextElement) {
        // Find the 'metapath' element within the context
        const metapathElement = contextElement.querySelector("metapath");
        const context = metapathElement
          ? metapathElement.getAttribute("target")
          : "";

        allContext[id] = context;
      } else {
        console.log(`Warning: No context found for constraint ${id}`);
      }
    });
  }

  return {
    constraints: Object.keys(allContext).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    ),
    allContext,
  };
}

function analyzeTestFiles() {
  const testFiles = fs
    .readdirSync(testDir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
  const testResults = {};

  for (const file of testFiles) {
    const filePath = path.join(testDir, file);
    const fileContent = fs.readFileSync(filePath, "utf8");
    const testCase = yaml.load(fileContent);

    if (testCase["test-case"] && testCase["test-case"].expectations) {
      for (const expectation of testCase["test-case"].expectations) {
        const constraintId = expectation["constraint-id"];
        const result = expectation.result;

        if (!testResults[constraintId]) {
          testResults[constraintId] = { pass_file: null, fail_file: null };
        }

        if (result === "pass" || file.toUpperCase().includes("PASS")) {
          testResults[constraintId].pass_file = file;
        } else if (result === "fail" || file.toUpperCase().includes("FAIL")) {
          testResults[constraintId].fail_file = file;
        }
      }
    }
  }

  return testResults;
}

async function scaffoldTest(constraintId, context) {
  const { confirm } = await prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Do you want to scaffold a test for ${constraintId}?`,
      default: true,
    },
  ]);

  if (!confirm) {
    console.log(`Skipping test scaffolding for ${constraintId}`);
    return;
  }

  const { model } = await prompt([
    {
      type: "string",
      name: "model",
      message: `What is the constraint targeting?`,
      default: "ssp",
    },
  ]);

  const { useTemplate } = await prompt([
    {
      type: "list",
      name: "useTemplate",
      message: `Choose the content for the negative test:`,
      choices: [
        { name: `Create new ${constraintId}-INVALID.xml`, value: "new" },
        { name: "Select an existing content file to copy", value: "select" },
        { name: "Point to an existing content file", value: "point" },
      ],
    },
  ]);

  let invalidContent;
  if (useTemplate === "new") {
    const templatePath =
      model === "ssp"
        ? path.join(
            __dirname,
            "..",
            "..",
            "src",
            "content",
            "rev5",
            "examples",
            "ssp/xml",
            "fedramp-ssp-example.oscal.xml"
          )
        : path.join(
            __dirname,
            "..",
            "..",
            "src",
            "validations",
            "constraints",
            "content",
            `${model}-all-VALID.xml`
          );
    const newInvalidPath = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "validations",
      "constraints",
      "content",
      `${model}-${constraintId}-INVALID.xml`
    );

    try {
      // Read the template XML
      const templateXml = fs.readFileSync(templatePath, "utf8");
      const dom = new JSDOM(templateXml, { contentType: "text/xml" });
      const document = dom.window.document;

      if (!context || typeof context !== "string" || context.trim() === "") {
        throw new Error("Invalid or empty context");
      }

      // Prepare the XPath
      const contextParts = context.split("/").filter(Boolean);
      let xpathExpression = "//" + contextParts[contextParts.length - 1];

      console.log(`Attempting to evaluate XPath: ${xpathExpression}`);

      // Use XPath to select the nodes specified by the context
      const xpathResult = document.evaluate(
        xpathExpression,
        document,
        null,
        dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      if (xpathResult.snapshotLength > 0) {
        // Create a new document
        const newDoc = document.implementation.createDocument(null, null, null);

        // Function to recursively clone nodes and their ancestors while preserving namespaces
        function cloneWithAncestors(node, newParent) {
          if (
            node.parentNode &&
            node.parentNode.nodeType === dom.window.Node.ELEMENT_NODE
          ) {
            // Clone the parent node, ensuring we carry over the namespace
            const parentClone = newDoc.createElementNS(
              node.parentNode.namespaceURI,
              node.parentNode.nodeName
            );

            // Clone the attributes (except schema declaration)
            Array.from(node.parentNode.attributes).forEach((attr) => {
              if (!attr.name.includes("schemaLocation")) {
                parentClone.setAttributeNS(
                  attr.namespaceURI,
                  attr.name,
                  attr.value
                );
              }
            });

            // Recursively clone its ancestors
            cloneWithAncestors(node.parentNode, parentClone);
            parentClone.appendChild(newParent);
          } else {
            newDoc.appendChild(newParent);
          }
        }

        // Clone only the first matching node and its ancestors
        const relevantNode = xpathResult.snapshotItem(0);
        const relevantClone = newDoc.importNode(relevantNode, true);
        cloneWithAncestors(relevantNode, relevantClone);

        // Serialize the new document
        const serializer = new dom.window.XMLSerializer();
        let filteredXml = serializer.serializeToString(newDoc);

        // Format the XML with indentation
        filteredXml = xmlFormatter(filteredXml, {
          indentation: "  ", // Two spaces for indentation
          collapseContent: true,
          lineSeparator: "\n",
        });
        // Write the new invalid XML file
        fs.writeFileSync(newInvalidPath, filteredXml, "utf8");
        console.log(`Created new ${model}-${constraintId}-INVALID.xml file`);
        invalidContent = `../content/${model}-${constraintId}-INVALID.xml`;
      } else {
        throw new Error(
          "Could not find the specified context in the template."
        );
      }
    } catch (error) {
      console.log(`Warning: ${error.message}. Using the full template.`);
      console.log(`Error details:`, error);
      fs.copyFileSync(templatePath, newInvalidPath);
      invalidContent = `../content/${model}-${constraintId}-INVALID.xml`;
    }
  } else if (useTemplate === "select") {
    const contentDir = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "validations",
      "constraints",
      "content"
    );
    const contentFiles = fs
      .readdirSync(contentDir)
      .filter((file) => file.endsWith(".xml"));
    const { selectedContent } = await prompt([
      {
        type: "list",
        name: "selectedContent",
        message: "Select an existing content file to copy:",
        choices: contentFiles,
      },
    ]);

    // Create a new invalid XML file based on the selected content
    const selectedContentPath = path.join(contentDir, selectedContent);
    const newInvalidPath = path.join(
      contentDir,
      `${model}-${constraintId}-INVALID.xml`
    );

    // Copy the selected content to the new file
    fs.copyFileSync(selectedContentPath, newInvalidPath);
    console.log(
      `Created new ${model}-${constraintId}-INVALID.xml file based on ${selectedContent}`
    );

    invalidContent = `../content/${model}-${constraintId}-INVALID.xml`;
  } else {
    const contentDir = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "validations",
      "constraints",
      "content"
    );
    const contentFiles = fs
      .readdirSync(contentDir)
      .filter((file) => file.endsWith(".xml"));
    const { selectedContent } = await prompt([
      {
        type: "list",
        name: "selectedContent",
        message: "Select an existing content file to point to:",
        choices: contentFiles,
      },
    ]);
    const selectedContentPath = path.join(contentDir, selectedContent);
    const selectedContentTarget = selectedContentPath.split("/").pop();
    console.log(
      `Pointed invalid test for ${constraintId} to ${selectedContentTarget}`
    );
    invalidContent = `../content/${selectedContentTarget}`;
  }

  const positivetestCase = {
    "test-case": {
      name: `Positive Test for ${constraintId}`,
      description: `This test case validates the behavior of constraint ${constraintId}`,
      content:
        model === "ssp"
          ? "../../../content/rev5/examples/ssp/xml/fedramp-ssp-example.oscal.xml"
          : `../content/${model}-all-VALID.xml`,
      expectations: [
        {
          "constraint-id": constraintId,
          result: "pass",
        },
      ],
    },
  };
  const negativetestCase = {
    "test-case": {
      name: `Negative Test for ${constraintId}`,
      description: `This test case validates the behavior of constraint ${constraintId}`,
      content: invalidContent,
      expectations: [
        {
          "constraint-id": constraintId,
          result: "fail",
        },
      ],
    },
  };

  const positiveYamlContent = yaml.dump(positivetestCase);
  const negativeYamlContent = yaml.dump(negativetestCase);
  const fileNamePASS = `${constraintId.toLowerCase()}-PASS.yaml`;
  const fileNameFAIL = `${constraintId.toLowerCase()}-FAIL.yaml`;
  const positiveFilePath = path.join(testDir, fileNamePASS);
  const negativefilePath = path.join(testDir, fileNameFAIL);
  fs.writeFileSync(positiveFilePath, positiveYamlContent, "utf8");
  fs.writeFileSync(negativefilePath, negativeYamlContent, "utf8");
  console.log(`Scaffolded test for ${constraintId} at ${positiveFilePath}`);
  console.log(`Scaffolded test for ${constraintId} at ${negativefilePath}`);

  return true;
}

async function selectConstraints(allConstraints) {
  if (process.argv.length > 2) {
    // If a constraint ID is provided as an argument, use it
    return [process.argv[2]];
  }
  const { selectedConstraints } = await prompt([
    {
      type: "checkbox",
      name: "selectedConstraints",
      message: "Select constraints to analyze:",
      choices: allConstraints,
      pageSize: 20,
    },
  ]);
  return selectedConstraints;
}

function getScenarioLineNumbers(featureFile, tests) {
  const content = fs.readFileSync(featureFile, "utf8");
  const lines = content.split("\n");
  const scenarioLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\|/g, "").trim();
    if (line === tests.fail_file || line === tests.pass_file) {
      scenarioLines.push(i + 1); // +1 because line numbers start at 1, not 0
    }
  }

  return scenarioLines;
}

async function runCucumberTest(constraintId, testFiles) {
  const passFile = testFiles.pass_file;
  const failFile = testFiles.fail_file;

  if (!passFile || !failFile) {
    console.log(
      `Skipping Cucumber test for ${constraintId}: Missing ${
        !passFile ? "PASS" : "FAIL"
      } test file`
    );
    return false;
  }

  const nodeOptions =
    "--loader ts-node/esm --no-warnings --experimental-specifier-resolution=node";
  const cucumberCommand = `npx cucumber-js`;

  let scenarioLines = getScenarioLineNumbers(featureFile, testFiles);

  if (scenarioLines.length === 0) {
    console.error(`No scenarios found for constraintId: ${constraintId}`);
    execSync("npm run-script test:coverage", {
      shell: true,
      stdio: "ignore",
      cwd: path.join(__dirname, "..", ".."),
    });
    scenarioLines = getScenarioLineNumbers(featureFile, testFiles);
    if (scenarioLines.length === 0) {
      return false;
    }
  }

  try {
    const isWindows = process.platform === "win32";
    for (const line of scenarioLines) {
      const command = isWindows
        ? `set "NODE_OPTIONS=${nodeOptions}" && ${cucumberCommand} "${featureFile}:${line}"`
        : `NODE_OPTIONS="${nodeOptions}" ${cucumberCommand} "${featureFile}:${line}"`;
      execSync(command, { stdio: "inherit", shell: true });
    }
    console.log(`Cucumber tests for ${constraintId} passed successfully.`);
    return true;
  } catch (error) {
    console.error(`Cucumber test for ${constraintId} failed:`, error.message);
    return false;
  }
}

async function main() {
  const { constraints: allConstraints, allContext } = await getAllConstraints();
  console.log(`Found ${allConstraints.length} constraints.`);
  const selectedConstraints = await selectConstraints(allConstraints);
  console.log(
    `Selected ${selectedConstraints.length} constraints for analysis.`
  );

  const testResults = analyzeTestFiles();

  console.log("\nConstraint Analysis and Test Execution:");
  for (const constraintId of selectedConstraints) {
    const testCoverage = testResults[constraintId];

    if (!testCoverage) {
      console.log(`No tests found for: ${constraintId}`);
      var context = allContext[constraintId];
      console.log(`Context for ${constraintId}: ${context}`);
      const scaffold = await scaffoldTest(constraintId, context);
      if (scaffold) {
        const passed = await runCucumberTest(constraintId, {
          pass_file: `${constraintId}-PASS.yaml`,
          fail_file: `${constraintId}-FAIL.yaml`,
        });
        console.log(`${constraintId}: Test ${passed ? "passed" : "failed"}`);
      }
    } else if (!testCoverage.pass_file) {
      console.log(`${constraintId}: Missing positive test`);
    } else if (!testCoverage.fail_file) {
      console.log(`${constraintId}: Missing negative test`);
    } else {
      console.log(`${constraintId}: Fully covered`);
      const passed = await runCucumberTest(constraintId, testCoverage);
      console.log(`${constraintId}: Test ${passed ? "passed" : "failed"}`);
    }
  }
}
main().catch(console.error);
