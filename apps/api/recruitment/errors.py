from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_handler


class Conflict(APIException):
    status_code = 409
    default_detail = "记录已经更新，请重新查看后再操作。未保存的内容仍保留在表单中。"


def exception_handler(exc, context):
    response = drf_handler(exc, context)
    if response is not None:
        response.data = {"errors": response.data}
    return response
