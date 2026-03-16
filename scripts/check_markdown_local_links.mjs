import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const rootMarkdownFiles = [
  'SYSTEM_MODEL.md',
  'AGENTS.md',
  'README.md',
  'DOCS_INDEX.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
];

const maintainedReadmes = [
  'docs/README.md',
  'awcms/README.md',
  'awcms-public/README.md',
  'awcms-public/primary/README.md',
  'awcms-public/smandapbun/README.md',
  'awcms-mobile/README.md',
  'awcms-mobile/primary/README.md',
  'awcms-esp32/README.md',
  'awcms-mcp/README.md',
  'awcms-ext/README.md',
  'awcms-edge/README.md',
  'packages/awcms-shared/README.md',
];

const ignoredPrefixes = ['.git/', 'node_modules/'];

const shouldSkipByIgnorePattern = (relativePath, ignorePatterns) => {
  return ignorePatterns.some((pattern) => {
    if (pattern.endsWith('/**')) {
      return relativePath.startsWith(pattern.slice(0, -3));
    }
    return relativePath === pattern;
  });
};

const stripCodeFences = (content) => {
  const lines = content.split(/\r?\n/);
  const output = [];
  let activeFence = null;
  let inHtmlComment = false;

  for (const line of lines) {
    if (activeFence) {
      if (new RegExp(`^\\s*${activeFence}`).test(line)) {
        activeFence = null;
      }
      output.push('');
      continue;
    }

    if (/^\s*```/.test(line)) {
      activeFence = '```';
      output.push('');
      continue;
    }

    if (/^\s*~~~/.test(line)) {
      activeFence = '~~~';
      output.push('');
      continue;
    }

    let cursor = 0;
    let sanitizedLine = '';

    while (cursor < line.length) {
      if (inHtmlComment) {
        const commentEnd = line.indexOf('-->', cursor);
        if (commentEnd === -1) {
          cursor = line.length;
          break;
        }
        cursor = commentEnd + 3;
        inHtmlComment = false;
        continue;
      }

      const commentStart = line.indexOf('<!--', cursor);
      if (commentStart === -1) {
        sanitizedLine += line.slice(cursor);
        break;
      }

      sanitizedLine += line.slice(cursor, commentStart);
      cursor = commentStart + 4;
      inHtmlComment = true;
    }

    output.push(sanitizedLine);
  }

  return output.join('\n');
};

const normalizeRawTarget = (rawTarget) => {
  const trimmed = rawTarget.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    return end >= 0 ? trimmed.slice(1, end).trim() : trimmed;
  }

  return trimmed.split(/\s+/)[0];
};

const isExternalTarget = (target) => {
  return target.startsWith('#')
    || target.startsWith('//')
    || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(target);
};

const extractTargets = (content) => {
  const targets = [];
  const stripped = stripCodeFences(content);
  const inlinePattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  const referencePattern = /^\s*\[[^\]]+\]:\s*(\S+)/gm;

  for (const pattern of [inlinePattern, referencePattern]) {
    for (const match of stripped.matchAll(pattern)) {
      const normalized = normalizeRawTarget(match[1] || '');
      if (normalized) {
        targets.push(normalized);
      }
    }
  }

  return targets;
};

const walkDocsDirectory = async (directory, fileList) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');

    if (ignoredPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDocsDirectory(absolutePath, fileList);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(relativePath);
    }
  }
};

const resolveCandidatePath = (sourceFile, target) => {
  const withoutAnchor = target.split('#')[0];
  if (!withoutAnchor) return null;

  let decoded = withoutAnchor;
  try {
    decoded = decodeURIComponent(withoutAnchor);
  } catch {
    decoded = withoutAnchor;
  }

  const sourceDir = path.dirname(path.join(repoRoot, sourceFile));
  return path.resolve(sourceDir, decoded);
};

const loadIgnorePatterns = async () => {
  const ignoreFile = path.join(repoRoot, '.markdownlintignore');
  const raw = await fs.readFile(ignoreFile, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

const fileExists = async (absolutePath) => {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
};

const main = async () => {
  const ignorePatterns = await loadIgnorePatterns();
  const docsFiles = [];
  await walkDocsDirectory(path.join(repoRoot, 'docs'), docsFiles);

  const candidateFiles = [
    ...rootMarkdownFiles,
    ...maintainedReadmes,
    ...docsFiles,
  ];

  const markdownFiles = [...new Set(candidateFiles)]
    .filter((relativePath) => !shouldSkipByIgnorePattern(relativePath, ignorePatterns));

  const failures = [];

  for (const relativeFile of markdownFiles) {
    const absoluteFile = path.join(repoRoot, relativeFile);
    if (!(await fileExists(absoluteFile))) {
      failures.push(`${relativeFile}: maintained markdown file is missing`);
      continue;
    }

    const content = await fs.readFile(absoluteFile, 'utf8');
    for (const target of extractTargets(content)) {
      if (isExternalTarget(target)) continue;

      const resolvedPath = resolveCandidatePath(relativeFile, target);
      if (!resolvedPath) continue;

      if (!(await fileExists(resolvedPath))) {
        failures.push(`${relativeFile}: missing local target '${target}'`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('Local markdown link validation failed:\n');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Validated local markdown targets for ${markdownFiles.length} maintained files.`);
};

await main();
