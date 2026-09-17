import 'package:flutter/material.dart';

import '../../../models/sort_option.dart';

class SortMenuButton extends StatelessWidget {
  const SortMenuButton({
    super.key,
    required this.current,
    required this.onChanged,
  });

  final SortOption current;
  final ValueChanged<SortOption> onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<SortOption>(
      icon: const Icon(Icons.sort),
      tooltip: 'Sort',
      initialValue: current,
      onSelected: onChanged,
      itemBuilder: (context) => SortOption.values
          .map(
            (option) => PopupMenuItem<SortOption>(
              value: option,
              child: Row(
                children: [
                  if (option == current)
                    const Icon(Icons.check, size: 18)
                  else
                    const SizedBox(width: 18),
                  const SizedBox(width: 8),
                  Text(option.label),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}
