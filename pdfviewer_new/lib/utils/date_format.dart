String formatFriendlyDate(DateTime dateTime) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final target = DateTime(dateTime.year, dateTime.month, dateTime.day);
  final dayDiff = today.difference(target).inDays;

  if (dayDiff == 0) return 'Today';
  if (dayDiff == 1) return 'Yesterday';
  if (dayDiff > 1 && dayDiff < 7) return '$dayDiff days ago';

  final month = dateTime.month.toString().padLeft(2, '0');
  final day = dateTime.day.toString().padLeft(2, '0');
  return '${dateTime.year}-$month-$day';
}
