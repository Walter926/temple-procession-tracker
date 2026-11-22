import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:temple_procession_tracker_app/core/models/access_code.dart';
import 'package:temple_procession_tracker_app/core/repositories/access_code_repository.dart';
import 'package:temple_procession_tracker_app/core/services/access_code_service.dart';
import 'package:temple_procession_tracker_app/features/auth/join_code_screen.dart';

class FakeCodeRepository implements AccessCodeRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class CodeResult<T> implements HttpsCallableResult<T> {
  @override
  final T data;
  CodeResult(this.data);
}

class CodeFunctions implements FirebaseFunctions {
  final calls = <(String, dynamic)>[];
  Object? error;
  Map<String, dynamic> response = {
    'id': 'hash',
    'code': 'AB12C3',
    'expiresAtMs': 1795000000000,
  };
  @override
  HttpsCallable httpsCallable(String name, {HttpsCallableOptions? options}) =>
      CodeCallable(this, name);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class CodeCallable implements HttpsCallable {
  final CodeFunctions owner;
  final String name;
  CodeCallable(this.owner, this.name);
  @override
  Future<HttpsCallableResult<T>> call<T>([dynamic parameters]) async {
    owner.calls.add((name, parameters));
    if (owner.error != null) throw owner.error!;
    return CodeResult<T>(owner.response as T);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late CodeFunctions functions;
  late AccessCodeService service;
  setUp(() {
    functions = CodeFunctions();
    service = AccessCodeService(
      functions: functions,
      accessCodeRepository: FakeCodeRepository(),
    );
  });
  test(
    'event creation sends integer defaults with 24-hour expiry and uses server expiry',
    () async {
      final earliestExpiry = DateTime.now()
          .add(const Duration(hours: 24))
          .millisecondsSinceEpoch;
      final issued = await service.generate(eventId: 'event');
      final latestExpiry = DateTime.now()
          .add(const Duration(hours: 24))
          .millisecondsSinceEpoch;
      final (name, payload) = functions.calls.single;
      expect(name, 'createAccessCode');
      expect(payload, {
        'eventId': 'event',
        'groupId': '',
        'scope': 'event',
        'grantedRole': 'teamMember',
        'enabled': true,
        'maxUses': 1000,
        'expiresAtMs': isA<int>(),
      });
      expect(payload['maxUses'], isA<int>());
      expect(
        payload['expiresAtMs'],
        inInclusiveRange(earliestExpiry, latestExpiry),
      );
      expect(
        issued.expiresAt!.millisecondsSinceEpoch,
        functions.response['expiresAtMs'],
      );
      expect(AccessCodeService.isValidFormat(issued.code), isTrue);
    },
  );
  test(
    'group creation preserves group scope and both supported bounds',
    () async {
      for (final uses in [1, 1000]) {
        final earliestExpiry = DateTime.now()
            .add(const Duration(hours: 24))
            .millisecondsSinceEpoch;
        await service.generate(
          eventId: 'event',
          groupId: 'group',
          maxUses: uses,
        );
        final latestExpiry = DateTime.now()
            .add(const Duration(hours: 24))
            .millisecondsSinceEpoch;
        final payload = functions.calls.last.$2;
        expect(payload['scope'], 'group');
        expect(payload['groupId'], 'group');
        expect(payload['maxUses'], uses);
        expect(payload['expiresAtMs'], isA<int>());
        expect(
          payload['expiresAtMs'],
          inInclusiveRange(earliestExpiry, latestExpiry),
        );
      }
    },
  );
  test(
    'legacy creation retains the returned code without a returned expiry',
    () async {
      functions.response = {'id': 'hash', 'code': 'ABCD-EF12-1234-5678-9012'};
      final issued = await service.generate(eventId: 'event');
      expect(issued.id, 'hash');
      expect(issued.code, 'ABCD-EF12-1234-5678-9012');
      expect(issued.expiresAt, isNull);
    },
  );
  test('malformed creation responses are rejected', () async {
    final valid = Map<String, dynamic>.of(functions.response);
    for (final response in <Map<String, dynamic>>[
      {'code': 'AB12C3'},
      {...valid, 'id': 17},
      {...valid, 'id': ' '},
      {...valid, 'code': null},
      {...valid, 'code': 'invalid'},
      {...valid, 'expiresAtMs': '1795000000000'},
      {...valid, 'expiresAtMs': double.nan},
      {...valid, 'expiresAtMs': double.infinity},
      {...valid, 'expiresAtMs': 1795000000000.5},
      {...valid, 'expiresAtMs': 0},
      {...valid, 'expiresAtMs': 8640000000000001},
    ]) {
      functions.response = response;
      await expectLater(service.generate(eventId: 'event'), throwsStateError);
    }
  });
  test('creation accepts an integral numeric server expiry', () async {
    functions.response['expiresAtMs'] = 1795000000000.0;
    final issued = await service.generate(eventId: 'event');
    expect(issued.expiresAt!.millisecondsSinceEpoch, 1795000000000);
  });
  test('invalid maximum uses never reach the callable', () async {
    for (final uses in [-1, 0, 1001]) {
      await expectLater(
        service.generate(eventId: 'event', maxUses: uses),
        throwsArgumentError,
      );
    }
    expect(functions.calls, isEmpty);
  });
  test(
    'redemption normalizes six characters and invalid formats never submit',
    () async {
      await service.redeem(' ab12c3 ');
      expect(functions.calls.single.$1, 'redeemAccessCode');
      expect(functions.calls.single.$2, {'code': 'AB12C3'});
      await expectLater(service.redeem('bad'), throwsArgumentError);
      expect(functions.calls, hasLength(1));
    },
  );
  test(
    'server authorization, expiry and exhaustion rejections propagate unchanged',
    () async {
      for (final code in [
        'permission-denied',
        'not-found',
        'failed-precondition',
        'resource-exhausted',
      ]) {
        final error = FirebaseFunctionsException(
          code: code,
          message: 'Rejected',
        );
        functions.error = error;
        await expectLater(
          service.generate(eventId: 'event'),
          throwsA(same(error)),
        );
        await expectLater(service.redeem('AB12C3'), throwsA(same(error)));
      }
    },
  );
  test(
    'legacy redemption normalizes only 20 hexadecimal symbols and leaves validation to the server',
    () async {
      await service.redeem(' abcd-ef12-1234-5678-9012 ');
      expect(functions.calls.single.$2, {'code': 'ABCDEF12123456789012'});
      for (final code in [
        'GBCDEF12123456789012',
        'ABCDEF1212345678901',
        'AB12-C3',
        'ABCD/EF12/1234/5678/9012',
      ]) {
        await expectLater(service.redeem(code), throwsArgumentError);
      }
      expect(functions.calls, hasLength(1));
    },
  );
  testWidgets('join input retains a complete old hyphenated invitation', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: JoinCodeScreen()));
    await tester.enterText(find.byType(TextField), 'ABCD-EF12-1234-5678-9012');
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'ABCD-EF12-1234-5678-9012',
    );
  });
  test(
    'history distinguishes exhaustion, expiry, revocation and legacy unlimited codes',
    () {
      final now = DateTime.utc(2026, 11, 20);
      AccessCode code({
        int maxUses = 1000,
        int used = 1000,
        bool enabled = true,
        DateTime? expiry,
      }) => AccessCode(
        id: 'hash',
        eventId: 'event',
        groupId: '',
        isActive: enabled,
        maxUses: maxUses,
        usedCount: used,
        createdAt: now,
        expiresAt: expiry ?? now.add(const Duration(hours: 24)),
      );
      expect(code().statusAt(now), 'Exhausted');
      expect(code(used: 999).statusAt(now), 'Active');
      expect(code(maxUses: 0).statusAt(now), 'Active');
      expect(code(expiry: now).statusAt(now), 'Expired');
      expect(code(enabled: false).statusAt(now), 'Revoked');
    },
  );
}
