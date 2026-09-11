# The Flask example, for docker-compose.yml at the repository root.
#
# One stage: the toolchain is the runtime. python:3.12-slim rather than Alpine, because
# cryptography ships manylinux wheels and would otherwise be compiled from Rust source.

FROM python:3.12-slim
# The counterpart of the unit's Environment=PYTHONDONTWRITEBYTECODE=1: the app writes nothing,
# and a __pycache__ beside the sources is the only thing that would contradict that.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /opt/hosted-fields-examples-python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# gunicorn, not `python app.py`: that branch is the Werkzeug development server, and the
# Werkzeug debugger behind a payment page is remote code execution. This is the unit's ExecStart.
#
# Shell form on purpose — LISTEN_ADDR and PORT are read by gunicorn's command line here, not by
# the app, and exec form would not expand them.
CMD gunicorn --bind ${LISTEN_ADDR:-127.0.0.1}:${PORT:-3004} --workers 2 app:app
