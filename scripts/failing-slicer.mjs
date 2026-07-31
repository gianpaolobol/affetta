if (process.argv.includes('--version') || process.argv.includes('--help')) {
  console.log('Affetta failing slicer fixture 1.0');
  process.exit(0);
}
console.log('fixture stdout: avvio motore simulato');
console.error('fixture stderr: guasto motore simulato');
setTimeout(() => process.exit(23), 50);
