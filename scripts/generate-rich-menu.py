#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import base64
from PIL import Image, ImageDraw, ImageFont

# 出力ディレクトリ
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_IMG = os.path.join(SCRIPT_DIR, 'rich-menu.png')
OUTPUT_BASE64 = os.path.join(SCRIPT_DIR, 'rich-menu-base64.txt')

# リッチメニュー仕様（LINE推奨解像度）
WIDTH = 2500
HEIGHT = 843

# 色指定
COLOR_BLACK = (0, 0, 0)
COLOR_DIVIDER = (51, 51, 51)
COLOR_WHITE = (255, 255, 255)
COLOR_PINK = (236, 0, 140)  # ハピネッツブランドカラー #EC008C
COLOR_GRAY = (204, 204, 204)
COLOR_DARK_GRAY = (102, 102, 102)

BAR_HEIGHT = 12
DIVIDER_X = 1250
DIVIDER_WIDTH = 3

def load_font(size):
    """フォントを読み込む（macOS ヒラギノ対応）"""
    font_paths = [
        '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
        '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
        '/System/Library/Fonts/Helvetica.ttc',
    ]
    for path in font_paths:
        try:
            return ImageFont.truetype(path, size=size)
        except (OSError, IOError):
            continue
    # フォント未発見時はデフォルト
    return ImageFont.load_default()

def draw_ticket_icon(draw, cx, cy, size=100):
    """チケットアイコンを描画（角丸矩形 + 破線）"""
    half_w = size
    half_h = size * 0.6
    radius = 15

    # 角丸矩形外郭
    bbox = [cx - half_w, cy - half_h, cx + half_w, cy + half_h]
    draw.rounded_rectangle(bbox, radius=radius, outline=COLOR_WHITE, width=4)

    # 破線（横線）
    line_y = cy
    dash_length = 20
    gap_length = 10
    for x in range(int(cx - half_w + 20), int(cx + half_w - 20), dash_length + gap_length):
        draw.line([x, line_y, x + dash_length, line_y], fill=COLOR_WHITE, width=3)

def draw_checkmark_icon(draw, cx, cy, size=100):
    """チェックマークアイコンを描画（円 + ✓）"""
    radius = size
    # 円
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                 outline=COLOR_WHITE, width=4)
    # チェックマーク（手書きようなストローク）
    # ✓ の左下から右上への線
    draw.line([cx - radius * 0.3, cy, cx - radius * 0.1, cy + radius * 0.25],
              fill=COLOR_WHITE, width=5)
    draw.line([cx - radius * 0.1, cy + radius * 0.25, cx + radius * 0.4, cy - radius * 0.3],
              fill=COLOR_WHITE, width=5)

def generate_rich_menu():
    """LINE リッチメニュー画像を生成"""
    # 黒背景
    img = Image.new('RGB', (WIDTH, HEIGHT), color=COLOR_BLACK)
    draw = ImageDraw.Draw(img)

    # 上部ピンクバー
    draw.rectangle(
        [(0, 0), (WIDTH, BAR_HEIGHT)],
        fill=COLOR_PINK
    )

    # 中央の縦区切り線
    draw.rectangle(
        [(DIVIDER_X, BAR_HEIGHT), (DIVIDER_X + DIVIDER_WIDTH, HEIGHT)],
        fill=COLOR_DIVIDER
    )

    # フォント読み込み
    font_main = load_font(88)  # メインテキスト
    font_sub = load_font(42)   # サブテキスト
    font_guide = load_font(32) # ガイドテキスト

    # ===== 左エリア（チケット申込）=====
    left_center_x = 625

    # チケットアイコン
    draw_ticket_icon(draw, left_center_x, 280, size=90)

    # メインテキスト「チケット申込」
    draw.text(
        (left_center_x, 420),
        'チケット申込',
        fill=COLOR_WHITE,
        font=font_main,
        anchor='mm'
    )

    # サブテキスト「試合チケットを申し込む」
    draw.text(
        (left_center_x, 530),
        '試合チケットを申し込む',
        fill=COLOR_GRAY,
        font=font_sub,
        anchor='mm'
    )

    # タップ誘導矢印 ▶
    draw.text(
        (left_center_x + 350, 420),
        '▶',
        fill=COLOR_PINK,
        font=font_sub,
        anchor='mm'
    )

    # ガイドテキスト
    draw.text(
        (left_center_x, 730),
        'タップして開く',
        fill=COLOR_DARK_GRAY,
        font=font_guide,
        anchor='mm'
    )

    # ===== 右エリア（申込確認）=====
    right_center_x = 1875

    # チェックマークアイコン
    draw_checkmark_icon(draw, right_center_x, 280, size=90)

    # メインテキスト「申込確認」
    draw.text(
        (right_center_x, 420),
        '申込確認',
        fill=COLOR_WHITE,
        font=font_main,
        anchor='mm'
    )

    # サブテキスト「申込状況を確認する」
    draw.text(
        (right_center_x, 530),
        '申込状況を確認する',
        fill=COLOR_GRAY,
        font=font_sub,
        anchor='mm'
    )

    # タップ誘導矢印 ▶
    draw.text(
        (right_center_x + 350, 420),
        '▶',
        fill=COLOR_PINK,
        font=font_sub,
        anchor='mm'
    )

    # ガイドテキスト
    draw.text(
        (right_center_x, 730),
        'タップして開く',
        fill=COLOR_DARK_GRAY,
        font=font_guide,
        anchor='mm'
    )

    # 画像を保存
    img.save(OUTPUT_IMG, 'PNG')
    print(f'✅ 画像を保存しました: {OUTPUT_IMG}')
    print(f'   サイズ: {WIDTH}×{HEIGHT}px')

    # Base64 エンコード
    with open(OUTPUT_IMG, 'rb') as f:
        img_data = f.read()
        b64_string = base64.b64encode(img_data).decode('utf-8')

    with open(OUTPUT_BASE64, 'w') as f:
        f.write(b64_string)

    print(f'✅ Base64文字列を保存しました: {OUTPUT_BASE64}')
    print(f'   文字列長: {len(b64_string)} 文字')

if __name__ == '__main__':
    generate_rich_menu()
