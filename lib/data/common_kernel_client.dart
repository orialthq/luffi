import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'analysis_server.dart';

const _kernelToken = String.fromEnvironment('LUFFI_KERNEL_TOKEN');

/// The shared development credential is never used by a release/profile build.
bool get commonKernelDebugEnabled =>
    kDebugMode && _kernelToken.trim().isNotEmpty;

typedef KernelJson = Map<String, Object?>;

abstract interface class CommonKernelClient {
  Future<KernelJson> contracts();
  Future<List<KernelJson>> listBoards();
  Future<KernelJson> getBoard(String activityId);
  Future<KernelJson> command(KernelJson command);
  Future<KernelJson> runTask({
    required String activityId,
    required String taskId,
    required int expectedRevision,
    required String commandId,
  });
}

final class CommonKernelException implements Exception {
  const CommonKernelException(this.code, this.message, {this.statusCode});

  final String code;
  final String message;
  final int? statusCode;

  bool get isRevisionConflict =>
      code == 'REVISION_CONFLICT' || code == 'CONTEXT_STALE';

  @override
  String toString() => message;
}

String newKernelCommandId() {
  final random = Random.secure();
  return List.generate(
    16,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
}

final class HttpCommonKernelClient implements CommonKernelClient {
  const HttpCommonKernelClient({
    this.baseUrl,
    this.token = _kernelToken,
    this.timeout = const Duration(seconds: 20),
  });

  final String? baseUrl;
  final String token;
  final Duration timeout;

  @override
  Future<KernelJson> contracts() => _request('GET', '/v1/kernel/contracts');

  @override
  Future<List<KernelJson>> listBoards() async {
    final response = await _request('GET', '/v1/kernel/boards');
    final boards = response['boards'];
    if (boards is! List || boards.any((board) => board is! Map)) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '활동 목록의 응답 형식을 확인해 주세요.',
      );
    }
    return boards
        .map((board) => Map<String, Object?>.from(board as Map))
        .toList();
  }

  @override
  Future<KernelJson> getBoard(String activityId) =>
      _request('GET', '/v1/kernel/boards/${Uri.encodeComponent(activityId)}');

  @override
  Future<KernelJson> command(KernelJson command) =>
      _request('POST', '/v1/kernel/activities/commands', command);

  @override
  Future<KernelJson> runTask({
    required String activityId,
    required String taskId,
    required int expectedRevision,
    required String commandId,
  }) => _request('POST', '/v1/kernel/activities/run-task', {
    'activityId': activityId,
    'taskId': taskId,
    'expectedRevision': expectedRevision,
    'commandId': commandId,
  });

  Future<KernelJson> _request(
    String method,
    String path, [
    KernelJson? body,
  ]) async {
    if (!kDebugMode || token.trim().isEmpty) {
      throw const CommonKernelException(
        'DEVELOPMENT_ONLY',
        '공통 활동은 토큰이 설정된 개발 빌드에서만 열 수 있어요.',
      );
    }
    final base = Uri.tryParse(baseUrl ?? defaultAnalysisBaseUrl());
    if (base == null ||
        !const {'http', 'https'}.contains(base.scheme) ||
        base.host.isEmpty ||
        base.userInfo.isNotEmpty) {
      throw const CommonKernelException(
        'INVALID_SERVER_URL',
        '개발 서버 주소를 확인해 주세요.',
      );
    }
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final request = await client
          .openUrl(method, base.resolve(path))
          .timeout(timeout);
      // Do not forward the development token to a redirect destination.
      request.followRedirects = false;
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close().timeout(timeout);
      final bytes = <int>[];
      await for (final chunk in response.timeout(timeout)) {
        bytes.addAll(chunk);
        if (bytes.length > 4 * 1024 * 1024) {
          throw const CommonKernelException(
            'RESPONSE_TOO_LARGE',
            '응답이 너무 커서 표시할 수 없어요.',
          );
        }
      }
      Object? decoded;
      try {
        decoded = jsonDecode(utf8.decode(bytes));
      } on FormatException {
        throw CommonKernelException(
          'INVALID_RESPONSE',
          '개발 서버가 올바른 JSON 응답을 보내지 않았어요.',
          statusCode: response.statusCode,
        );
      }
      if (decoded is! Map<String, dynamic>) {
        throw const CommonKernelException(
          'INVALID_RESPONSE',
          '개발 서버의 응답 형식을 확인해 주세요.',
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final error = decoded['error'];
        throw CommonKernelException(
          error is Map && error['code'] is String
              ? error['code'] as String
              : 'HTTP_ERROR',
          error is Map && error['message'] is String
              ? error['message'] as String
              : '요청을 처리하지 못했어요 (${response.statusCode}).',
          statusCode: response.statusCode,
        );
      }
      return Map<String, Object?>.from(decoded);
    } on TimeoutException {
      throw const CommonKernelException(
        'NETWORK_TIMEOUT',
        '응답을 기다리는 시간이 길어졌어요. 새로고침으로 현재 상태를 확인해 주세요.',
      );
    } on SocketException {
      throw const CommonKernelException(
        'NETWORK_UNAVAILABLE',
        '개발 서버에 연결할 수 없어요. 주소와 서버 실행 상태를 확인해 주세요.',
      );
    } on HttpException {
      throw const CommonKernelException(
        'NETWORK_UNAVAILABLE',
        '연결이 끊겼어요. 새로고침으로 현재 상태를 확인해 주세요.',
      );
    } finally {
      client.close(force: true);
    }
  }
}
