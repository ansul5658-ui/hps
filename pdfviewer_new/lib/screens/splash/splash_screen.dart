import 'package:flutter/material.dart';

import '../../core/constants/app_colors.dart';
import '../main_shell.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnimation;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );

    _fadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeIn,
    );

    _scaleAnimation = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
    );

    _controller.forward();

    Future.delayed(const Duration(milliseconds: 1800), () {
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        PageRouteBuilder(
          transitionDuration: const Duration(milliseconds: 500),
          pageBuilder: (_, __, ___) => const MainShell(),
          transitionsBuilder: (_, animation, __, child) {
            return FadeTransition(opacity: animation, child: child);
          },
        ),
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? AppColors.bgDark : AppColors.bgLight,
      body: Center(
        child: FadeTransition(
          opacity: _fadeAnimation,
          child: ScaleTransition(
            scale: _scaleAnimation,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const PaperKitMark(size: 96),
                const SizedBox(height: 24),
                Text(
                  'PaperKit',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Scan. Convert. Share.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: isDark
                        ? AppColors.textSecondaryDark
                        : AppColors.textSecondaryLight,
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The PaperKit mark, drawn to the same geometry as the launcher icon so the
/// splash and the home screen icon are pixel-identical to what the user tapped
/// on their home screen. Painted rather than loaded as an asset, so it needs no
/// pubspec asset entry and stays sharp at any size.
class PaperKitMark extends StatelessWidget {
  const PaperKitMark({super.key, this.size = 96});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _MarkPainter()),
    );
  }
}

class _MarkPainter extends CustomPainter {
  static const Color _brand = Color(0xFF6C5CE7);
  static const Color _fold = Color(0xFFB9AEF5);

  @override
  void paint(Canvas canvas, Size size) {
    // Icon geometry is authored on a 1024 grid; scale it to whatever we get.
    final double s = size.width / 1024.0;

    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Offset.zero & size,
        Radius.circular(228 * s),
      ),
      Paint()..color = _brand,
    );

    final Path page = Path()
      ..moveTo(300 * s, 232 * s)
      ..lineTo(594 * s, 232 * s)
      ..lineTo(724 * s, 362 * s)
      ..lineTo(724 * s, 792 * s)
      ..lineTo(300 * s, 792 * s)
      ..close();

    // Fill plus a round-joined stroke of the same colour rounds the corners.
    canvas.drawPath(page, Paint()..color = Colors.white);
    canvas.drawPath(
      page,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 26 * s
        ..strokeJoin = StrokeJoin.round,
    );

    final Path fold = Path()
      ..moveTo(594 * s, 232 * s)
      ..lineTo(594 * s, 362 * s)
      ..lineTo(724 * s, 362 * s)
      ..close();

    canvas.drawPath(fold, Paint()..color = _fold);
    canvas.drawPath(
      fold,
      Paint()
        ..color = _fold
        ..style = PaintingStyle.stroke
        ..strokeWidth = 18 * s
        ..strokeJoin = StrokeJoin.round,
    );

    final Paint bar = Paint()..color = _brand;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(366 * s, 486 * s, 256 * s, 46 * s),
        Radius.circular(23 * s),
      ),
      bar,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(366 * s, 580 * s, 172 * s, 46 * s),
        Radius.circular(23 * s),
      ),
      bar,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}