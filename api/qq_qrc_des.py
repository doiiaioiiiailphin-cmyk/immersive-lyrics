# -*- coding: utf-8 -*-
"""QQ QRC DES variant used by QQ Music lyric payloads."""
from enum import Enum


class DESMode(Enum):
    DES_ENCRYPT = 'DES_ENCRYPT'
    DES_DECRYPT = 'DES_DECRYPT'


def bit_num(a: bytearray, b: int, c: int):
    byte_index = (b // 32) * 4 + 3 - (b % 32) // 8
    bit_position = 7 - (b % 8)
    extracted_bit = (a[byte_index] >> bit_position) & 0x01
    return extracted_bit << c


def bit_num_int_r(a: int, b: int, c: int) -> int:
    extracted_bit = (a >> (31 - b)) & 0x00000001
    return extracted_bit << c


def bit_num_int_l(a: int, b: int, c: int) -> int:
    extracted_bit = (a << b) & 0x80000000
    return extracted_bit >> c


def s_box_bit(a: int) -> int:
    part1 = (a & 0x20)
    part2 = ((a & 0x1f) >> 1)
    part3 = ((a & 0x01) << 4)
    return part1 | part2 | part3


s_box1 = [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13
]

s_box2 = [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
	3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9
]

s_box3 = [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12
]

s_box4 = [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14
]

s_box5 = [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3
]

s_box6 = [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13
]

s_box7 = [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12
]

s_box8 = [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11
]


def ip(state: list, in_bytes: bytearray):
    state[0] = (
            bit_num(in_bytes, 57, 31) | bit_num(in_bytes, 49, 30) | bit_num(in_bytes, 41, 29) |
            bit_num(in_bytes, 33, 28) | bit_num(in_bytes, 25, 27) | bit_num(in_bytes, 17, 26) |
            bit_num(in_bytes, 9, 25) | bit_num(in_bytes, 1, 24) | bit_num(in_bytes, 59, 23) |
            bit_num(in_bytes, 51, 22) | bit_num(in_bytes, 43, 21) | bit_num(in_bytes, 35, 20) |
            bit_num(in_bytes, 27, 19) | bit_num(in_bytes, 19, 18) | bit_num(in_bytes, 11, 17) |
            bit_num(in_bytes, 3, 16) | bit_num(in_bytes, 61, 15) | bit_num(in_bytes, 53, 14) |
            bit_num(in_bytes, 45, 13) | bit_num(in_bytes, 37, 12) | bit_num(in_bytes, 29, 11) |
            bit_num(in_bytes, 21, 10) | bit_num(in_bytes, 13, 9) | bit_num(in_bytes, 5, 8) |
            bit_num(in_bytes, 63, 7) | bit_num(in_bytes, 55, 6) | bit_num(in_bytes, 47, 5) |
            bit_num(in_bytes, 39, 4) | bit_num(in_bytes, 31, 3) | bit_num(in_bytes, 23, 2) |
            bit_num(in_bytes, 15, 1) | bit_num(in_bytes, 7, 0)
    )
    state[1] = (
            bit_num(in_bytes, 56, 31) | bit_num(in_bytes, 48, 30) | bit_num(in_bytes, 40, 29) |
            bit_num(in_bytes, 32, 28) | bit_num(in_bytes, 24, 27) | bit_num(in_bytes, 16, 26) |
            bit_num(in_bytes, 8, 25) | bit_num(in_bytes, 0, 24) | bit_num(in_bytes, 58, 23) |
            bit_num(in_bytes, 50, 22) | bit_num(in_bytes, 42, 21) | bit_num(in_bytes, 34, 20) |
            bit_num(in_bytes, 26, 19) | bit_num(in_bytes, 18, 18) | bit_num(in_bytes, 10, 17) |
            bit_num(in_bytes, 2, 16) | bit_num(in_bytes, 60, 15) | bit_num(in_bytes, 52, 14) |
            bit_num(in_bytes, 44, 13) | bit_num(in_bytes, 36, 12) | bit_num(in_bytes, 28, 11) |
            bit_num(in_bytes, 20, 10) | bit_num(in_bytes, 12, 9) | bit_num(in_bytes, 4, 8) |
            bit_num(in_bytes, 62, 7) | bit_num(in_bytes, 54, 6) | bit_num(in_bytes, 46, 5) |
            bit_num(in_bytes, 38, 4) | bit_num(in_bytes, 30, 3) | bit_num(in_bytes, 22, 2) |
            bit_num(in_bytes, 14, 1) | bit_num(in_bytes, 6, 0)
    )
    return state


def inv_ip(state: list, in_bytes: bytearray):
    in_bytes[3] = (
            bit_num_int_r(state[1], 7, 7) | bit_num_int_r(state[0], 7, 6) |
            bit_num_int_r(state[1], 15, 5) | bit_num_int_r(state[0], 15, 4) |
            bit_num_int_r(state[1], 23, 3) | bit_num_int_r(state[0], 23, 2) |
            bit_num_int_r(state[1], 31, 1) | bit_num_int_r(state[0], 31, 0)
    )
    in_bytes[2] = (
            bit_num_int_r(state[1], 6, 7) | bit_num_int_r(state[0], 6, 6) |
            bit_num_int_r(state[1], 14, 5) | bit_num_int_r(state[0], 14, 4) |
            bit_num_int_r(state[1], 22, 3) | bit_num_int_r(state[0], 22, 2) |
            bit_num_int_r(state[1], 30, 1) | bit_num_int_r(state[0], 30, 0)
    )
    in_bytes[1] = (
            bit_num_int_r(state[1], 5, 7) | bit_num_int_r(state[0], 5, 6) |
            bit_num_int_r(state[1], 13, 5) | bit_num_int_r(state[0], 13, 4) |
            bit_num_int_r(state[1], 21, 3) | bit_num_int_r(state[0], 21, 2) |
            bit_num_int_r(state[1], 29, 1) | bit_num_int_r(state[0], 29, 0)
    )
    in_bytes[0] = (
            bit_num_int_r(state[1], 4, 7) | bit_num_int_r(state[0], 4, 6) |
            bit_num_int_r(state[1], 12, 5) | bit_num_int_r(state[0], 12, 4) |
            bit_num_int_r(state[1], 20, 3) | bit_num_int_r(state[0], 20, 2) |
            bit_num_int_r(state[1], 28, 1) | bit_num_int_r(state[0], 28, 0)
    )
    in_bytes[7] = (
            bit_num_int_r(state[1], 3, 7) | bit_num_int_r(state[0], 3, 6) |
            bit_num_int_r(state[1], 11, 5) | bit_num_int_r(state[0], 11, 4) |
            bit_num_int_r(state[1], 19, 3) | bit_num_int_r(state[0], 19, 2) |
            bit_num_int_r(state[1], 27, 1) | bit_num_int_r(state[0], 27, 0)
    )
    in_bytes[6] = (
            bit_num_int_r(state[1], 2, 7) | bit_num_int_r(state[0], 2, 6) |
            bit_num_int_r(state[1], 10, 5) | bit_num_int_r(state[0], 10, 4) |
            bit_num_int_r(state[1], 18, 3) | bit_num_int_r(state[0], 18, 2) |
            bit_num_int_r(state[1], 26, 1) | bit_num_int_r(state[0], 26, 0)
    )
    in_bytes[5] = (
            bit_num_int_r(state[1], 1, 7) | bit_num_int_r(state[0], 1, 6) |
            bit_num_int_r(state[1], 9, 5) | bit_num_int_r(state[0], 9, 4) |
            bit_num_int_r(state[1], 17, 3) | bit_num_int_r(state[0], 17, 2) |
            bit_num_int_r(state[1], 25, 1) | bit_num_int_r(state[0], 25, 0)
    )
    in_bytes[4] = (
            bit_num_int_r(state[1], 0, 7) | bit_num_int_r(state[0], 0, 6) |
            bit_num_int_r(state[1], 8, 5) | bit_num_int_r(state[0], 8, 4) |
            bit_num_int_r(state[1], 16, 3) | bit_num_int_r(state[0], 16, 2) |
            bit_num_int_r(state[1], 24, 1) | bit_num_int_r(state[0], 24, 0)
    )
    return in_bytes


def f(state: int, key: list) -> int:
    lrgstate = [0] * 6

    # Expansion Permutation
    t1 = (bit_num_int_l(state, 31, 0) | ((state & 0xf0000000) >> 1) | bit_num_int_l(state, 4, 5) |
          bit_num_int_l(state, 3, 6) | ((state & 0x0f000000) >> 3) | bit_num_int_l(state, 8, 11) |
          bit_num_int_l(state, 7, 12) | ((state & 0x00f00000) >> 5) | bit_num_int_l(state, 12, 17) |
          bit_num_int_l(state, 11, 18) | ((state & 0x000f0000) >> 7) | bit_num_int_l(state, 16, 23))

    t2 = (bit_num_int_l(state, 15, 0) | ((state & 0x0000f000) << 15) | bit_num_int_l(state, 20, 5) |
          bit_num_int_l(state, 19, 6) | ((state & 0x00000f00) << 13) | bit_num_int_l(state, 24, 11) |
          bit_num_int_l(state, 23, 12) | ((state & 0x000000f0) << 11) | bit_num_int_l(state, 28, 17) |
          bit_num_int_l(state, 27, 18) | ((state & 0x0000000f) << 9) | bit_num_int_l(state, 0, 23))

    lrgstate[0] = (t1 >> 24) & 0x000000ff
    lrgstate[1] = (t1 >> 16) & 0x000000ff
    lrgstate[2] = (t1 >> 8) & 0x000000ff
    lrgstate[3] = (t2 >> 24) & 0x000000ff
    lrgstate[4] = (t2 >> 16) & 0x000000ff
    lrgstate[5] = (t2 >> 8) & 0x000000ff

    # Key XOR
    for i in range(6):
        lrgstate[i] ^= key[i]

    # S-Box Permutation
    state = (s_box1[s_box_bit(lrgstate[0] >> 2)] << 28) | \
            (s_box2[s_box_bit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >> 4))] << 24) | \
            (s_box3[s_box_bit(((lrgstate[1] & 0x0f) << 2) | (lrgstate[2] >> 6))] << 20) | \
            (s_box4[s_box_bit(lrgstate[2] & 0x3f)] << 16) | \
            (s_box5[s_box_bit(lrgstate[3] >> 2)] << 12) | \
            (s_box6[s_box_bit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >> 4))] << 8) | \
            (s_box7[s_box_bit(((lrgstate[4] & 0x0f) << 2) | (lrgstate[5] >> 6))] << 4) | \
            s_box8[s_box_bit(lrgstate[5] & 0x3f)]

    # P-Box Permutation
    state = (bit_num_int_l(state, 15, 0) | bit_num_int_l(state, 6, 1) | bit_num_int_l(state, 19, 2) |
             bit_num_int_l(state, 20, 3) | bit_num_int_l(state, 28, 4) | bit_num_int_l(state, 11, 5) |
             bit_num_int_l(state, 27, 6) | bit_num_int_l(state, 16, 7) | bit_num_int_l(state, 0, 8) |
             bit_num_int_l(state, 14, 9) | bit_num_int_l(state, 22, 10) | bit_num_int_l(state, 25, 11) |
             bit_num_int_l(state, 4, 12) | bit_num_int_l(state, 17, 13) | bit_num_int_l(state, 30, 14) |
             bit_num_int_l(state, 9, 15) | bit_num_int_l(state, 1, 16) | bit_num_int_l(state, 7, 17) |
             bit_num_int_l(state, 23, 18) | bit_num_int_l(state, 13, 19) | bit_num_int_l(state, 31, 20) |
             bit_num_int_l(state, 26, 21) | bit_num_int_l(state, 2, 22) | bit_num_int_l(state, 8, 23) |
             bit_num_int_l(state, 18, 24) | bit_num_int_l(state, 12, 25) | bit_num_int_l(state, 29, 26) |
             bit_num_int_l(state, 5, 27) | bit_num_int_l(state, 21, 28) | bit_num_int_l(state, 10, 29) |
             bit_num_int_l(state, 3, 30) | bit_num_int_l(state, 24, 31))

    # Return the final state value
    return state


def des_key_setup(key: bytearray, schedule: list, mode: DESMode):
    key_rnd_shift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
    key_perm_c = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17,
                  9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35]
    key_perm_d = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
                  13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3]
    key_compression = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9,
                       22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
                       40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47,
                       43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31]

    # Permutated Choice #1 (copy the key in, ignoring parity bits).
    c = 0
    d = 0
    for i in range(28):
        c |= bit_num(key, key_perm_c[i], 31 - i)
        d |= bit_num(key, key_perm_d[i], 31 - i)

    # Generate the 16 subkeys.
    for i in range(16):
        c = ((c << key_rnd_shift[i]) | (c >> (28 - key_rnd_shift[i]))) & 0xfffffff0
        d = ((d << key_rnd_shift[i]) | (d >> (28 - key_rnd_shift[i]))) & 0xfffffff0

        # Decryption subkeys are reverse order of encryption subkeys
        to_gen = 15 - i if mode == DESMode.DES_DECRYPT else i

        # Initialize the array
        schedule[to_gen] = [0] * 6
        for j in range(24):
            schedule[to_gen][j // 8] |= bit_num_int_r(c, key_compression[j], 7 - (j % 8))
        for j in range(24, 48):
            schedule[to_gen][j // 8] |= bit_num_int_r(d, key_compression[j] - 27, 7 - (j % 8))
    return 0


def des_crypt(input_bytes: bytearray, key_schedule: list):
    state = [0, 0]

    # Initial Permutation
    ip(state, input_bytes)

    for idx in range(15):
        t = state[1]
        i = f(state[1], key_schedule[idx])
        state[1] = i ^ state[0]
        state[0] = t

    # Perform the final loop manually as it doesn't switch sides
    state[0] = f(state[1], key_schedule[15]) ^ state[0]

    # Inverse Initial Permutation
    # output_bytes = inv_ip(state, output_bytes)
    inv_ip(state, input_bytes)
    return input_bytes


KEY1 = b"!@#)(NHLiuy*$%^&"
KEY2 = b"123ZXC!@#)(*$%^&"
KEY3 = b"!@#)(*$%^&abcDEF"


def func_des(buff: bytearray, key: bytes, length: int) -> bytearray:
    schedule = [[0] * 6 for _ in range(16)]
    des_key_setup(bytearray(key), schedule, DESMode.DES_ENCRYPT)
    output = bytearray()
    for i in range(0, length, 8):
        output += des_crypt(buff[i:i + 8], schedule)
    return output


def func_ddes(buff: bytearray, key: bytes, length: int) -> bytearray:
    schedule = [[0] * 6 for _ in range(16)]
    des_key_setup(bytearray(key), schedule, DESMode.DES_DECRYPT)
    output = bytearray()
    for i in range(0, length, 8):
        output += des_crypt(buff[i:i + 8], schedule)
    return output


def lyric_decode(content: bytearray, length: int) -> bytearray:
    content = func_ddes(content, KEY1, length)
    content = func_des(content, KEY2, length)
    content = func_ddes(content, KEY3, length)
    return content


