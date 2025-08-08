// file: src/app/api/playlist/[playlistId]/route.test.ts

/**
 * @jest-environment node
 */
import { GET } from './route'; // Import your route handler
import { NextResponse } from 'next/server';

// Mock the googleapis library
jest.mock('googleapis', () => ({
  google: {
    youtube: jest.fn(() => ({
      playlistItems: {
        list: jest.fn(), // We will define the behavior of this mock in each test
      },
    })),
  },
}));

// A little TypeScript magic to get the mocked function
import { google } from 'googleapis';
const mockPlaylistItemsList = (google.youtube('v3').playlistItems.list as jest.Mock);