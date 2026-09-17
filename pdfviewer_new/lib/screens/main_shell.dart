import 'package:flutter/material.dart';

import '../core/constants/app_colors.dart';
import 'bookmarks/bookmarks_screen.dart';
import 'favorites/favorites_screen.dart';
import 'home/home_screen.dart';
import 'settings/settings_screen.dart';
import 'tools_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _currentIndex = 0;

  void _onTabSelected(int index) {
    setState(() => _currentIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // Tab order: 0 Library · 1 Tools · 2 Favorites · 3 Bookmarks · 4 Settings
    final screens = [
      HomeScreen(
        onNavigateToFavorites: () => _onTabSelected(2),
        onNavigateToBookmarks: () => _onTabSelected(3),
        onNavigateToSettings: () => _onTabSelected(4),
      ),
      const ToolsScreen(),
      const FavoritesScreen(),
      const BookmarksScreen(),
      const SettingsScreen(),
    ];

    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: screens,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: isDark ? AppColors.borderDark : AppColors.borderLight,
            ),
          ),
        ),
        child: NavigationBar(
          selectedIndex: _currentIndex,
          onDestinationSelected: _onTabSelected,
          elevation: 0,
          backgroundColor: isDark ? AppColors.bgDark : AppColors.bgLight,
          indicatorColor: AppColors.primaryLight.withOpacity(0.15),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.picture_as_pdf_outlined),
              selectedIcon: Icon(Icons.picture_as_pdf_rounded, color: AppColors.primaryLight),
              label: 'Library',
            ),
            NavigationDestination(
              icon: Icon(Icons.handyman_outlined),
              selectedIcon: Icon(Icons.handyman_rounded, color: AppColors.accentTeal),
              label: 'Tools',
            ),
            NavigationDestination(
              icon: Icon(Icons.star_outline_rounded),
              selectedIcon: Icon(Icons.star_rounded, color: Colors.amber),
              label: 'Favorites',
            ),
            NavigationDestination(
              icon: Icon(Icons.bookmark_outline_rounded),
              selectedIcon: Icon(Icons.bookmark_rounded, color: AppColors.accentBlue),
              label: 'Bookmarks',
            ),
            NavigationDestination(
              icon: Icon(Icons.settings_outlined),
              selectedIcon: Icon(Icons.settings_rounded, color: AppColors.accentTeal),
              label: 'Settings',
            ),
          ],
        ),
      ),
    );
  }
}