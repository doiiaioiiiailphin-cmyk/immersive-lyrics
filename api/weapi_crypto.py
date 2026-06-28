# -*- coding: utf-8 -*-
"""网易云 WeAPI 加密。

移植自 chaunsin/netease-cloud-music (MIT License, Copyright 2024 chaunsin)
https://github.com/chaunsin/netease-cloud-music/blob/master/pkg/crypto/crypto.go

WeAPI 加密算法（用于登录/搜索/歌词等需要 cookie 校验的接口）:
    1. 随机生成 16 位 secretKey（base62）
    2. AES-CBC 两层加密（presetKey + secretKey），PKCS7 填充
    3. RSA 无填充加密（反转的 secretKey + 公钥）
    4. 返回 {params, encSecKey}

常量与原项目一致。
"""
import json
import random
import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

# 常量（来自原项目 crypto.go）
_BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
_IV = b'0102030405060708'
_PRESET_KEY = b'0CoJUm6Qyw8W8jud'
_RSA_E = 0x10001  # 65537
# 网易云 RSA 公钥 modulus（hex，从 PEM 提取的公认值）
_RSA_N_HEX = (
    'e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b72515'
    '2b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ec'
    'bda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d8'
    '13cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
)


def _random_key():
    """生成 16 位随机 base62 字符串（secretKey）。"""
    return ''.join(random.choice(_BASE62) for _ in range(16))


def _reverse_string(s):
    return s[::-1]


def _aes_cbc_base64(plaintext, key, iv):
    """AES-CBC 加密 + PKCS7 填充，返回 base64。"""
    cipher = AES.new(key, AES.MODE_CBC, iv)
    padded = pad(plaintext.encode('utf-8'), AES.block_size)
    encrypted = cipher.encrypt(padded)
    return base64.b64encode(encrypted).decode('ascii')


def _rsa_no_padding(data_str, n_hex):
    """RSA 无填充加密（m^e mod n）。

    网易云用 raw RSA（无 PKCS#1 填充），直接做模幂运算。
    data_str: 要加密的字符串
    返回 hex 字符串。
    """
    n = int(n_hex, 16)
    # data 转 bytes 再转 int（big-endian）
    data_bytes = data_str.encode('utf-8')
    m = int.from_bytes(data_bytes, 'big')
    # m^e mod n
    result = pow(m, _RSA_E, n)
    # 转 hex（与原项目 hex.EncodeToString 一致，不补前导零）
    return format(result, 'x')


def weapi_encrypt(obj):
    """WeAPI 加密。

    obj: dict，会被 JSON 序列化
    返回 {'params': str, 'encSecKey': str}
    """
    data = json.dumps(obj, separators=(',', ':'), ensure_ascii=False)
    secret_key = _random_key()
    # 第一层 AES：presetKey 加密原文
    enc_text = _aes_cbc_base64(data, _PRESET_KEY, _IV)
    # 第二层 AES：secretKey 加密第一层结果
    params = _aes_cbc_base64(enc_text, secret_key.encode('utf-8'), _IV)
    # RSA：加密反转的 secretKey
    enc_sec_key = _rsa_no_padding(_reverse_string(secret_key), _RSA_N_HEX)
    return {'params': params, 'encSecKey': enc_sec_key}
