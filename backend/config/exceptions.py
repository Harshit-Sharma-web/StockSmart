from django.db import IntegrityError, OperationalError
from rest_framework.response import Response
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    if isinstance(exc, IntegrityError) and exc.args and exc.args[0] == 1062:
        return Response({"detail": "A conflicting record already exists.", "code": "duplicate"}, status=409)
    if isinstance(exc, OperationalError) and exc.args and exc.args[0] in {1205, 1213}:
        return Response({"detail": "The transaction was rolled back. Retry the request.", "code": "retry"}, status=409)
    return exception_handler(exc, context)
