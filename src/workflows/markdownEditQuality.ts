import fs from 'node:fs';
import path from 'node:path';
import type { EditStrategy } from '../types.js';
import { isDocumentationFile } from './editStrategy.js';

export interface MarkdownQualityContext {
  userRequest?: string;
  userText?: string | null;
  projectNames?: string[];
  strategy?: EditStrategy;
}

export interface MarkdownQualityResult {
  valid: boolean;
  errors: string[];
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /added by (?:the )?ai/i,
  /- line added by/i,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /\bTBD\b/,
  /\bFIXME\b/,
  /\bTODO\b/,
  /\[insert[^\]]*\]/i,
  /<(?:your|project)[^>]*>/i,
];

const LITERAL_ESCAPE_PATTERN = /\\[ntr]/;

export function extractUserSpecifiedText(userRequest: string): string | null {
  const quoted = userRequest.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1]!.trim();

  const patterns = [
    /\badd\s+(.+?)\s+(?:as|at|to|in|into)\s+(?:a\s+)?(?:clean\s+)?(?:final\s+)?(?:markdown\s+)?line\b/i,
    /\badd\s+(.+?)\s+(?:as|at|to|in|into)\b/i,
    /\bappend\s+(.+?)\s+(?:to|at|in)\b/i,
  ];

  for (const pattern of patterns) {
    const match = userRequest.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

export function isCleanLineAppendRequest(userRequest: string): boolean {
  return /\bclean\b.*\b(?:markdown\s+)?line\b/i.test(userRequest) ||
    /\bfinal\s+markdown\s+line\b/i.test(userRequest);
}

export function getProjectDisplayNames(projectRoot: string): string[] {
  const names = new Set<string>();
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (pkg.name) {
        names.add(pkg.name);
        names.add(pkg.name.replace(/-/g, ' '));
        names.add(
          pkg.name
            .split('-')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('-'),
        );
        names.add(
          pkg.name
            .split('-')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' '),
        );
      }
    }
  } catch {
    // ignore unreadable package.json
  }

  const folder = path.basename(projectRoot);
  if (folder) {
    names.add(folder);
    names.add(folder.replace(/-/g, ' '));
  }

  return [...names].filter(Boolean);
}

export function sanitizeMarkdownEscapes(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
}

export function validateMarkdownEditContent(
  text: string,
  context: MarkdownQualityContext = {},
): MarkdownQualityResult {
  const errors: string[] = [];

  if (LITERAL_ESCAPE_PATTERN.test(text)) {
    errors.push('Contains literal escape sequences (\\n, \\t, or \\r)');
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      errors.push('Contains disallowed placeholder or AI attribution text');
      break;
    }
  }

  if (context.userText) {
    const trimmed = text.trim();
    const requested = context.userText.trim();
    if (context.userRequest && isCleanLineAppendRequest(context.userRequest)) {
      if (trimmed !== requested) {
        errors.push(`Clean line append must be exactly: "${requested}"`);
      }
    } else if (!trimmed.includes(requested)) {
      errors.push(`Does not preserve requested text: "${requested}"`);
    }
  }

  if (context.projectNames?.length && context.userRequest) {
    const requestLower = context.userRequest.toLowerCase();
    for (const name of context.projectNames) {
      if (!name || requestLower.includes(name.toLowerCase())) continue;
      if (context.userText && context.userText.includes(name)) continue;
      if (text.includes(name)) {
        errors.push(`Contains project name "${name}" not requested by user`);
      }
    }
  }

  if (context.strategy === 'append_section' && context.userRequest && isCleanLineAppendRequest(context.userRequest)) {
    if (text.includes('\n\n\n')) {
      errors.push('Malformed markdown: excessive blank lines in append');
    }
    if (/^#+\s/m.test(text) && context.userText && !context.userRequest.toLowerCase().includes('section')) {
      errors.push('Unexpected markdown heading in clean line append');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function normalizeMarkdownEditContent(
  rawContent: string,
  context: MarkdownQualityContext,
): { content: string; error?: string; adjusted?: boolean } {
  let content = sanitizeMarkdownEscapes(rawContent).trim();
  let adjusted = false;

  const userText = context.userText ?? (context.userRequest ? extractUserSpecifiedText(context.userRequest) : null);

  if (userText && context.userRequest && isCleanLineAppendRequest(context.userRequest)) {
    if (content !== userText) {
      content = userText;
      adjusted = true;
    }
  } else if (userText && !content.includes(userText)) {
    const projectPrefix = context.projectNames?.find((name) => content.includes(name));
    if (projectPrefix && content.replace(projectPrefix, '').trim().endsWith(userText.replace(projectPrefix, '').trim())) {
      content = userText;
      adjusted = true;
    } else if (/\badd\b/i.test(context.userRequest ?? '') && userText) {
      content = userText;
      adjusted = true;
    }
  }

  const validation = validateMarkdownEditContent(content, {
    ...context,
    userText,
  });

  if (!validation.valid) {
    return { content, error: validation.errors.join('; '), adjusted };
  }

  return { content, adjusted };
}

export function validateMarkdownFileEdit(
  targetPath: string,
  replaceOrContent: string,
  context: MarkdownQualityContext = {},
): MarkdownQualityResult {
  if (!isDocumentationFile(targetPath)) {
    return { valid: true, errors: [] };
  }

  const userText = context.userText ?? (context.userRequest ? extractUserSpecifiedText(context.userRequest) : null);
  const rawValidation = validateMarkdownEditContent(replaceOrContent, { ...context, userText });
  if (!rawValidation.valid) {
    return rawValidation;
  }

  const normalized = normalizeMarkdownEditContent(replaceOrContent, { ...context, userText });
  if (normalized.error) {
    return { valid: false, errors: [normalized.error] };
  }
  return { valid: true, errors: [] };
}

export function formatMarkdownQualityError(targetPath: string, errors: string[]): string {
  return [`Markdown edit quality check failed for ${targetPath}:`, ...errors.map((e) => `- ${e}`)].join('\n');
}
