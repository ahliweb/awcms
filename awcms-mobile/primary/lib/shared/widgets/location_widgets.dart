/// AWCMS Mobile - Location Widgets
///
/// Widget untuk location UI: status, permission, fake warning.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/extensions/context_extensions.dart';
import '../../core/services/location_service.dart';

/// Location status indicator chip
class LocationStatusChip extends ConsumerWidget {
  const LocationStatusChip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locationState = ref.watch(locationServiceProvider);
    final colorScheme = Theme.of(context).colorScheme;

    IconData icon;
    Color bgColor;
    Color fgColor;
    String label;

    switch (locationState.status) {
      case LocationStatus.success:
        icon = Icons.location_on;
        bgColor = colorScheme.primaryContainer;
        fgColor = colorScheme.onPrimaryContainer;
        label = context.l10n.locationActive;
        break;
      case LocationStatus.fetching:
        icon = Icons.my_location;
        bgColor = colorScheme.secondaryContainer;
        fgColor = colorScheme.onSecondaryContainer;
        label = context.l10n.loading;
        break;
      case LocationStatus.fakeDetected:
        icon = Icons.gps_off;
        bgColor = colorScheme.errorContainer;
        fgColor = colorScheme.onErrorContainer;
        label = context.l10n.locationFake;
        break;
      case LocationStatus.permissionDenied:
      case LocationStatus.permissionDeniedForever:
        icon = Icons.location_disabled;
        bgColor = colorScheme.tertiaryContainer;
        fgColor = colorScheme.onTertiaryContainer;
        label = context.l10n.locationPermissionDenied;
        break;
      case LocationStatus.serviceDisabled:
        icon = Icons.location_off;
        bgColor = colorScheme.surfaceContainerHighest;
        fgColor = colorScheme.onSurfaceVariant;
        label = context.l10n.locationDisabled;
        break;
      default:
        icon = Icons.location_searching;
        bgColor = colorScheme.surfaceContainerHighest;
        fgColor = colorScheme.onSurfaceVariant;
        label = context.l10n.gps;
    }

    return InkWell(
      onTap: () =>
          ref.read(locationServiceProvider.notifier).getCurrentLocation(),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (locationState.isLoading)
              SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: fgColor,
                ),
              )
            else
              Icon(icon, size: 16, color: fgColor),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: fgColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Fake GPS warning banner
class FakeLocationWarning extends ConsumerWidget {
  const FakeLocationWarning({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locationState = ref.watch(locationServiceProvider);

    if (locationState.status != LocationStatus.fakeDetected) {
      return const SizedBox.shrink();
    }

    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      color: colorScheme.error,
      child: Row(
        children: [
          const Icon(Icons.warning_amber, color: Colors.white, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.l10n.fakeLocationDetected,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                    fontSize: 13,
                  ),
                ),
                Text(
                  locationState.errorMessage ??
                      context.l10n.fakeLocationMessage,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Location permission dialog
class LocationPermissionDialog extends StatelessWidget {
  final VoidCallback? onSettings;
  final VoidCallback? onCancel;

  const LocationPermissionDialog({super.key, this.onSettings, this.onCancel});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon: const Icon(Icons.location_on, size: 48),
      title: Text(context.l10n.locationPermissionRequired),
      content: Text(context.l10n.locationPermissionExplanation),
      actions: [
        TextButton(
          onPressed: onCancel ?? () => Navigator.of(context).pop(),
          child: Text(context.l10n.cancel),
        ),
        FilledButton(
          onPressed: onSettings ?? () => Navigator.of(context).pop(),
          child: Text(context.l10n.openSettings),
        ),
      ],
    );
  }
}

/// Location card with coordinates
class LocationCard extends ConsumerWidget {
  final bool showRefresh;

  const LocationCard({super.key, this.showRefresh = true});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locationState = ref.watch(locationServiceProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: locationState.isMocked
                        ? colorScheme.errorContainer
                        : colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    locationState.isMocked ? Icons.gps_off : Icons.location_on,
                    color: locationState.isMocked
                        ? colorScheme.onErrorContainer
                        : colorScheme.onPrimaryContainer,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        context.l10n.locationGPS,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      Text(
                        locationState.isMocked
                            ? context.l10n.invalidLocation
                            : _getStatusText(context, locationState.status),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                if (showRefresh)
                  IconButton(
                    onPressed: locationState.isLoading
                        ? null
                        : () => ref
                              .read(locationServiceProvider.notifier)
                              .getCurrentLocation(),
                    icon: locationState.isLoading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.refresh),
                  ),
              ],
            ),
            if (locationState.hasPosition) ...[
              const SizedBox(height: 12),
              const Divider(),
              const SizedBox(height: 12),
              _buildCoordRow(
                context,
                context.l10n.latitude,
                locationState.position!.latitude.toStringAsFixed(6),
              ),
              const SizedBox(height: 8),
              _buildCoordRow(
                context,
                context.l10n.longitude,
                locationState.position!.longitude.toStringAsFixed(6),
              ),
              const SizedBox(height: 8),
              _buildCoordRow(
                context,
                context.l10n.accuracy,
                '${locationState.position!.accuracy.toStringAsFixed(0)} ${context.l10n.meters}',
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildCoordRow(BuildContext context, String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          value,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            fontFamily: 'monospace',
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  String _getStatusText(BuildContext context, LocationStatus status) {
    switch (status) {
      case LocationStatus.success:
        return context.l10n.locationObtained;
      case LocationStatus.fetching:
        return context.l10n.gettingLocation;
      case LocationStatus.error:
        return context.l10n.locationError;
      case LocationStatus.permissionDenied:
        return context.l10n.locationPermissionDenied;
      case LocationStatus.serviceDisabled:
        return context.l10n.locationServiceDisabled;
      default:
        return context.l10n.noLocation;
    }
  }
}
