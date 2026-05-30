import fs from 'node:fs';
import path from 'node:path';
import type { FrameworkInfo } from '../types.js';
import { parsePackageJsonDependencies } from './stackDetector.js';

interface FrameworkRule {
  name: string;
  check: (root: string, deps: Set<string>) => boolean;
}

const FRAMEWORK_RULES: FrameworkRule[] = [
  {
    name: 'Next.js',
    check: (root, deps) => deps.has('next') || fs.existsSync(path.join(root, 'next.config.js')) || fs.existsSync(path.join(root, 'next.config.mjs')) || fs.existsSync(path.join(root, 'next.config.ts')),
  },
  {
    name: 'Expo',
    check: (root, deps) => deps.has('expo') || fs.existsSync(path.join(root, 'app.json')) && fs.existsSync(path.join(root, '.expo')),
  },
  {
    name: 'React',
    check: (_root, deps) => deps.has('react'),
  },
  {
    name: 'Vue',
    check: (_root, deps) => deps.has('vue'),
  },
  {
    name: 'Svelte',
    check: (_root, deps) => deps.has('svelte'),
  },
  {
    name: 'Express',
    check: (_root, deps) => deps.has('express'),
  },
  {
    name: 'Fastify',
    check: (_root, deps) => deps.has('fastify'),
  },
  {
    name: 'NestJS',
    check: (_root, deps) => deps.has('@nestjs/core'),
  },
  {
    name: 'Django',
    check: (root) => fs.existsSync(path.join(root, 'manage.py')),
  },
  {
    name: 'Flask',
    check: (root) => fs.existsSync(path.join(root, 'requirements.txt')) && fs.readdirSync(root).some((f) => f.endsWith('.py')),
  },
];

export function detectFrameworks(root: string): FrameworkInfo {
  const deps = parsePackageJsonDependencies(root);
  const depNames = new Set(deps.map((d) => d.name));

  const frameworks: string[] = [];
  for (const rule of FRAMEWORK_RULES) {
    if (rule.check(root, depNames)) {
      frameworks.push(rule.name);
    }
  }

  const priority = ['Next.js', 'Expo', 'NestJS', 'Express', 'Fastify', 'React', 'Vue', 'Svelte'];
  const primary = priority.find((f) => frameworks.includes(f)) ?? frameworks[0] ?? null;

  return { frameworks, primary };
}
