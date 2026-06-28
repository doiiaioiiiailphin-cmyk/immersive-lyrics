# -*- coding: utf-8 -*-
"""Minimal MQTT v5-over-WebSocket client for QQ Music QR login.

Protocol behavior is based on the MIT-licensed implementation at:
https://github.com/AstronW/netease-qq-music-api
"""
import json
import random
import struct
import time

import websocket


MQTT_HOST = 'mu.y.qq.com'
MQTT_PATH = '/ws/handshake'
MQTT_KEEP_ALIVE = 45
MQTT_CONNECT_TIMEOUT = 5
MQTT_EVENT_TIMEOUT = 1.5
MQTT_MAX_REDIRECTS = 3


class QQMqttError(Exception):
    pass


def _varint(value):
    out = bytearray()
    while True:
        digit = value % 128
        value //= 128
        if value:
            digit |= 0x80
        out.append(digit)
        if not value:
            return bytes(out)


def _read_varint(data, offset=0):
    value = 0
    multiplier = 1
    while offset < len(data):
        digit = data[offset]
        offset += 1
        value += (digit & 0x7f) * multiplier
        if not digit & 0x80:
            return value, offset
        multiplier *= 128
        if multiplier > 128 ** 3:
            raise QQMqttError('invalid MQTT variable integer')
    raise QQMqttError('truncated MQTT variable integer')


def _utf8(value):
    raw = str(value).encode('utf-8')
    return struct.pack('!H', len(raw)) + raw


def _read_utf8(data, offset):
    if offset + 2 > len(data):
        raise QQMqttError('truncated MQTT string')
    length = struct.unpack('!H', data[offset:offset + 2])[0]
    offset += 2
    end = offset + length
    if end > len(data):
        raise QQMqttError('truncated MQTT string body')
    return data[offset:end].decode('utf-8', 'replace'), end


def _user_properties(items):
    out = bytearray()
    for key, value in items:
        out.append(0x26)
        out.extend(_utf8(key))
        out.extend(_utf8(value))
    return bytes(out)


def _packet(packet_type, flags, body):
    return bytes([(packet_type << 4) | flags]) + _varint(len(body)) + body


def _connect_packet(qrcode_id):
    props = bytearray()
    props.append(0x15)
    props.extend(_utf8('pass'))
    props.extend(_user_properties([
        ('tmeAppID', 'qqmusic'),
        ('business', 'management'),
        ('hashTag', qrcode_id),
        ('clientTag', 'management.user'),
        ('userID', qrcode_id),
    ]))
    variable = _utf8('MQTT') + bytes([5, 0x02]) + struct.pack('!H', MQTT_KEEP_ALIVE)
    variable += _varint(len(props)) + bytes(props)
    client_id = '%d%d' % (int(time.time() * 1000), random.randint(1000, 9999))
    return _packet(1, 0, variable + _utf8(client_id))


def _subscribe_packet(qrcode_id):
    props = _user_properties([
        ('authorization', 'tmelogin'),
        ('pubsub', 'unicast'),
    ])
    body = struct.pack('!H', 1) + _varint(len(props)) + props
    body += _utf8('management.qrcode_login/%s' % qrcode_id) + b'\x00'
    return _packet(8, 2, body)


def _parse_packet(raw):
    if isinstance(raw, str):
        raw = raw.encode('utf-8')
    if not raw or len(raw) < 2:
        raise QQMqttError('empty MQTT packet')
    packet_type = raw[0] >> 4
    flags = raw[0] & 0x0f
    remaining, offset = _read_varint(raw, 1)
    body = raw[offset:offset + remaining]
    if len(body) != remaining:
        raise QQMqttError('truncated MQTT packet')
    return packet_type, flags, body


def _parse_properties(data, offset):
    length, offset = _read_varint(data, offset)
    end = offset + length
    props = {}
    user_props = {}
    while offset < end:
        prop_id = data[offset]
        offset += 1
        if prop_id in (0x12, 0x15, 0x1a, 0x1c):
            value, offset = _read_utf8(data, offset)
            props[prop_id] = value
        elif prop_id == 0x26:
            key, offset = _read_utf8(data, offset)
            value, offset = _read_utf8(data, offset)
            user_props[key] = value
        elif prop_id in (0x01, 0x17, 0x19, 0x25):
            offset += 1
        elif prop_id in (0x13, 0x21, 0x22, 0x23):
            offset += 2
        elif prop_id in (0x02, 0x11, 0x18, 0x27):
            offset += 4
        else:
            raise QQMqttError('unsupported MQTT property: 0x%02x' % prop_id)
    return props, user_props, end


class QQLoginMqttSession:
    def __init__(self, qrcode_id):
        self.qrcode_id = qrcode_id
        self.ws = None
        self.state = 'waiting'
        self.server_reference = None

    def close(self):
        ws, self.ws = self.ws, None
        if ws:
            try:
                ws.close()
            except Exception:
                pass

    def _open(self):
        self.close()
        path = MQTT_PATH
        if self.server_reference:
            path += '/' + self.server_reference
        url = 'wss://%s:443%s' % (MQTT_HOST, path)
        try:
            self.ws = websocket.create_connection(
                url,
                timeout=MQTT_CONNECT_TIMEOUT,
                subprotocols=['mqtt'],
                origin='https://y.qq.com',
                header=['Referer: https://y.qq.com/'],
                enable_multithread=True,
            )
            self.ws.send_binary(_connect_packet(self.qrcode_id))
            packet_type, _, body = _parse_packet(self.ws.recv())
            if packet_type != 2 or len(body) < 3:
                raise QQMqttError('expected MQTT CONNACK')
            reason = body[1]
            props, _, _ = _parse_properties(body, 2)
            if reason in (0x9c, 0x9d):
                self.server_reference = props.get(0x1c)
                self.close()
                if not self.server_reference:
                    raise QQMqttError('MQTT redirect missing server')
                return False
            if reason != 0:
                raise QQMqttError('MQTT connect rejected: 0x%02x' % reason)
            self.ws.send_binary(_subscribe_packet(self.qrcode_id))
            deadline = time.monotonic() + MQTT_CONNECT_TIMEOUT
            while time.monotonic() < deadline:
                packet_type, _, body = _parse_packet(self.ws.recv())
                if packet_type == 9:
                    if len(body) < 3 or body[-1] >= 0x80:
                        raise QQMqttError('MQTT subscribe rejected')
                    return True
                if packet_type == 3:
                    event = self._parse_publish(body, 0)
                    if event:
                        self.state = event.get('state', self.state)
            raise QQMqttError('MQTT subscribe timed out')
        except Exception:
            self.close()
            raise

    def connect(self):
        for _ in range(MQTT_MAX_REDIRECTS + 1):
            if self._open():
                return
        raise QQMqttError('too many MQTT redirects')

    def _parse_publish(self, body, flags):
        _, offset = _read_utf8(body, 0)
        qos = (flags >> 1) & 0x03
        if qos:
            offset += 2
        _, user_props, offset = _parse_properties(body, offset)
        event_type = user_props.get('type')
        payload = body[offset:]
        if event_type == 'scanned':
            return {'state': 'scanned'}
        if event_type == 'timeout':
            return {'state': 'expired'}
        if event_type == 'canceled':
            return {'state': 'canceled'}
        if event_type == 'loginFailed':
            return {'state': 'failed'}
        if event_type == 'cookies':
            try:
                data = json.loads(payload.decode('utf-8'))
                cookies = data.get('cookies') or {}
                music_id = _cookie_value(cookies.get('qqmusic_uin'))
                music_key = _cookie_value(cookies.get('qqmusic_key'))
                if music_id and music_key:
                    return {'state': 'cookies', 'music_id': int(music_id), 'music_key': music_key}
            except (ValueError, TypeError, json.JSONDecodeError):
                pass
            return {'state': 'failed'}
        return None

    def poll(self):
        if not self.ws:
            try:
                self.connect()
            except Exception as e:
                raise QQMqttError('QQ扫码连接失败: %s' % e)
        self.ws.settimeout(MQTT_EVENT_TIMEOUT)
        try:
            raw = self.ws.recv()
        except websocket.WebSocketTimeoutException:
            return {'state': self.state}
        except Exception as e:
            self.close()
            raise QQMqttError('QQ扫码连接中断: %s' % e)
        packet_type, flags, body = _parse_packet(raw)
        if packet_type == 3:
            event = self._parse_publish(body, flags)
            if event:
                self.state = event.get('state', self.state)
                if self.state in ('expired', 'canceled', 'failed', 'cookies'):
                    self.close()
                return event
        elif packet_type == 12:
            self.ws.send_binary(_packet(13, 0, b''))
        elif packet_type == 14:
            self.close()
            return {'state': 'failed'}
        return {'state': self.state}



def _flatten(value, prefix=''):
    out = {}
    if isinstance(value, dict):
        for key, item in value.items():
            name = str(key)
            if isinstance(item, dict) and 'value' in item:
                out[name] = _cookie_value(item)
            else:
                out[name] = _cookie_value(item) if not isinstance(item, (dict, list)) else ''
                out.update(_flatten(item, name + '.'))
    elif isinstance(value, list):
        for idx, item in enumerate(value):
            out.update(_flatten(item, prefix + str(idx) + '.'))
    return {k: v for k, v in out.items() if v != ''}


def _first_value(flat, names):
    for name in names:
        if flat.get(name):
            return flat[name]
    for key, value in flat.items():
        tail = key.rsplit('.', 1)[-1]
        if tail in names and value:
            return value
    return ''

def _cookie_value(value):
    if isinstance(value, dict):
        value = value.get('value')
    if value is None:
        return ''
    return str(value)
