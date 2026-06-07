export function main(argv: string[]): Promise<void> {
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write("git-harvest v0.3.0\n");

    return Promise.resolve();
  }
  process.stdout.write("git-harvest\n");

  return Promise.resolve();
}

await main(process.argv.slice(2));
