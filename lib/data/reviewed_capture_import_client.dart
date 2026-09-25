import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

import '../domain/models.dart';
import 'analysis_server.dart';

const _kernelToken = String.fromEnvironment('LUFFI_KERNEL_TOKEN');

/// Only an explicit human review produces this immutable import request.
/// Raw image bytes and local attachment paths stay on the device. The same
/// serialized request is persisted before first send.
Map<String, Object?>? reviewedCaptureImportRequest(CaptureRecord capture) {
  final review = capture.review;
  final analysis = capture.analysis;
  final structured = analysis?.structuredContent;
  if (capture.raw.origin == CaptureOrigin.demo ||
      capture.status != CaptureStatus.organized ||
      analysis?.status != AnalysisRunStatus.succeeded ||
      structured == null ||
      review == null ||
      !const {
        ReviewResolution.confirmed,
        ReviewResolution.corrected,
      }.contains(review.resolution)) {
    return null;
  }
  final identity = '${capture.raw.id}\u0000${analysis!.id}\u0000${review.id}';
  final importId = 'reviewed-${sha256.convert(utf8.encode(identity))}';
  final sourcePackage = capture.raw.sourcePackage;
  final sourceApp =
      sourcePackage != null &&
          sourcePackage.length <= 512 &&
          RegExp(r'^[a-zA-Z0-9_.-]+$').hasMatch(sourcePackage)
      ? sourcePackage
      : null;
  String? sourceUrl;
  final rawUrl = capture.raw.rawUrl;
  if (rawUrl != null) {
    final uri = Uri.tryParse(rawUrl);
    if (uri != null &&
        const {'http', 'https'}.contains(uri.scheme) &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty) {
      // Query parameters may carry private tracking tokens. The origin/path
      // identify the captured page without sending those tokens to the KG.
      sourceUrl = '${uri.origin}${uri.path}';
    }
  }
  return <String, Object?>{
    'importId': importId,
    'capture': <String, Object?>{
      'id': capture.raw.id,
      'capturedAt': capture.raw.receivedAt.toUtc().toIso8601String(),
      'sourceApp': sourceApp,
      'sourceUrl': sourceUrl,
      'locale': null,
      'asset': <String, Object?>{
        'status': capture.raw.attachments.isEmpty
            ? 'unavailable'
            : 'device_only',
      },
    },
    'reviewed': true,
    'reviewedAt': review.reviewedAt.toUtc().toIso8601String(),
    'analysis': structured.toJson(),
    'analysisRunId': analysis.id,
  };
}

final class ReviewedCaptureImportReceipt {
  const ReviewedCaptureImportReceipt({
    required this.importId,
    required this.sourceId,
    required this.sourceVersionId,
    required this.materialId,
    required this.replayed,
  });

  final String importId;
  final String sourceId;
  final String sourceVersionId;
  final String materialId;
  final bool replayed;
}

abstract interface class ReviewedCaptureImportClient {
  Future<ReviewedCaptureImportReceipt> importReviewedCapture(
    Map<String, Object?> request,
  );

  Future<void> deleteReviewedImport({
    required String importId,
    required String commandId,
  });
}

final class ReviewedCaptureImportException implements Exception {
  const ReviewedCaptureImportException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => '$code: $message';
}

/// A development-only bridge to the authenticated common-kernel API.
final class HttpReviewedCaptureImportClient
    implements ReviewedCaptureImportClient {
  const HttpReviewedCaptureImportClient({
    this.baseUrl,
    this.token = _kernelToken,
    this.timeout = const Duration(seconds: 20),
  });

  final String? baseUrl;
  final String token;
  final Duration timeout;

  @override
  Future<ReviewedCaptureImportReceipt> importReviewedCapture(
    Map<String, Object?> request,
  ) async {
    final decoded = await _postJson(
      '/v1/kernel/ingestion/reviewed-capture',
      request,
    );
    final importId = decoded['importId'];
    final sourceId = decoded['sourceId'];
    final sourceVersionId = decoded['sourceVersionId'];
    final materialId = decoded['materialId'];
    final replayed = decoded['replayed'];
    if (importId != request['importId'] ||
        sourceId is! String ||
        sourceId.isEmpty ||
        sourceVersionId is! String ||
        sourceVersionId.isEmpty ||
        materialId is! String ||
        materialId.isEmpty ||
        replayed is! bool) {
      throw const ReviewedCaptureImportException(
        'INVALID_RESPONSE',
        'Reviewed import receipt was incomplete.',
      );
    }
    return ReviewedCaptureImportReceipt(
      importId: importId as String,
      sourceId: sourceId,
      sourceVersionId: sourceVersionId,
      materialId: materialId,
      replayed: replayed,
    );
  }

  @override
  Future<void> deleteReviewedImport({
    required String importId,
    required String commandId,
  }) async {
    final result = await _postJson(
      '/v1/kernel/ingestion/reviewed-capture/delete',
      {'importId': importId, 'commandId': commandId},
    );
    if (result['importId'] != importId) {
      throw const ReviewedCaptureImportException(
        'INVALID_RESPONSE',
        'Import deletion receipt did not match the reviewed capture.',
      );
    }
  }

  Future<Map<String, dynamic>> _postJson(
    String path,
    Map<String, Object?> request,
  ) async {
    if (!kDebugMode || token.trim().isEmpty) {
      throw const ReviewedCaptureImportException(
        'DEVELOPMENT_ONLY',
        'Reviewed capture import requires a development kernel token.',
      );
    }
    final base = Uri.tryParse(baseUrl ?? defaultAnalysisBaseUrl());
    if (base == null ||
        !const {'http', 'https'}.contains(base.scheme) ||
        base.host.isEmpty ||
        base.userInfo.isNotEmpty) {
      throw const ReviewedCaptureImportException(
        'INVALID_SERVER_URL',
        'Invalid development server URL.',
      );
    }
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      return await _exchange(
        client,
        base.resolve(path),
        request,
      ).timeout(timeout);
    } on TimeoutException {
      throw const ReviewedCaptureImportException(
        'NETWORK_TIMEOUT',
        'Reviewed import response timed out.',
      );
    } on SocketException {
      throw const ReviewedCaptureImportException(
        'NETWORK_UNAVAILABLE',
        'Development server is unavailable.',
      );
    } on HttpException {
      throw const ReviewedCaptureImportException(
        'NETWORK_UNAVAILABLE',
        'Development server connection failed.',
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<Map<String, dynamic>> _exchange(
    HttpClient client,
    Uri uri,
    Map<String, Object?> body,
  ) async {
    final request = await client.postUrl(uri);
    request.followRedirects = false;
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(body));
    final response = await request.close();
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
      if (bytes.length > 4 * 1024 * 1024) {
        throw const ReviewedCaptureImportException(
          'RESPONSE_TOO_LARGE',
          'Reviewed import response exceeded the size limit.',
        );
      }
    }
    Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(bytes));
    } on FormatException {
      throw const ReviewedCaptureImportException(
        'INVALID_RESPONSE',
        'Reviewed import response was not JSON.',
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw const ReviewedCaptureImportException(
        'INVALID_RESPONSE',
        'Reviewed import response was not an object.',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded['error'];
      throw ReviewedCaptureImportException(
        error is Map && error['code'] is String
            ? error['code'] as String
            : 'HTTP_ERROR',
        error is Map && error['message'] is String
            ? error['message'] as String
            : 'Reviewed import failed (${response.statusCode}).',
      );
    }
    return decoded;
  }
}
