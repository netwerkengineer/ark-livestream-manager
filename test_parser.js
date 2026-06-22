const WIDGET_IDS = [
  // Faders
  81, 82, 83, 84, 85,
  // Colors (using actual button widget IDs: startId + 1 to startId + 8)
  ...[10, 30, 40, 50, 60, 100, 110, 120, 130].flatMap(startId => 
    Array.from({ length: 8 }, (_, i) => startId + 1 + i)
  )
];
console.log(WIDGET_IDS.slice(0, 20));
