declare module "semver" {
  export class SemVer {
    constructor(version: string);
    version: string;
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
  }

  export function valid(v: string): string | null;
  export function clean(v: string): string | null;
  export function satisfies(version: string, range: string): boolean;
  export function gt(v1: string, v2: string): boolean;
  export function lt(v1: string, v2: string): boolean;
  export function inc(v: string, release: string): string | null;
}
