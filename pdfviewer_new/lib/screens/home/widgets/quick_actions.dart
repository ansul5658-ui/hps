import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';

class QuickActionsGrid extends StatelessWidget {
  const QuickActionsGrid({
    super.key,
    required this.onImport,
    required this.onFavoritesTap,
    required this.onBookmarksTap,
    required this.onSettingsTap,
  });

  final VoidCallback onImport;
  final VoidCallback onFavoritesTap;
  final VoidCallback onBookmarksTap;
  final VoidCallback onSettingsTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          _QuickActionTile(
            icon: Icons.add_circle_outline_rounded,
            label: 'Import',
            color: AppColors.primaryLight,
            onTap: onImport,
          ),
          const SizedBox(width: 10),
          _QuickActionTile(
            icon: Icons.star_rounded,
            label: 'Favorites',
            color: Colors.amber.shade700,
            onTap: onFavoritesTap,
          ),
          const SizedBox(width: 10),
          _QuickActionTile(
            icon: Icons.bookmark_rounded,
            label: 'Bookmarks',
            color: AppColors.accentBlue,
            onTap: onBookmarksTap,
          ),
          const SizedBox(width: 10),
          _QuickActionTile(
            icon: Icons.settings_rounded,
            label: 'Settings',
            color: AppColors.accentTeal,
            onTap: onSettingsTap,
          ),
        ],
      ),
    );
  }
}

class _QuickActionTile extends StatelessWidget {
  const _QuickActionTile({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: isDark ? AppColors.cardDark : AppColors.cardLight,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isDark ? AppColors.borderDark : AppColors.borderLight,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 8),
              Text(
                label,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
