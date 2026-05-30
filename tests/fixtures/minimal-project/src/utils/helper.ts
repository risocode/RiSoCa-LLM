export function helper(): string {
  return 'ok';
}

export class HelperService {
  run(): void {
    fetch('https://api.example.com/data');
  }
}
