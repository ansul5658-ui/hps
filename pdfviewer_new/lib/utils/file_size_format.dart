String formatFileSize(int bytes) {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  var size = bytes.toDouble();
  var unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  final formatted =
      unitIndex == 0 ? size.toStringAsFixed(0) : size.toStringAsFixed(1);
  return '$formatted ${units[unitIndex]}';
}
