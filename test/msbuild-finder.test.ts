import { MSBuildFinder } from '../src/msbuild/msbuild-finder';
import { MSBuildOptions } from '../src/msbuild/msbuild-options';
import { ArchitectureService } from '../src/utilities/ArchitectureService';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Mock modules
jest.mock('fs');
jest.mock('child_process');
jest.mock('../src/utilities/ArchitectureService');

describe('MSBuildFinder', () => {
    let mockOptions: MSBuildOptions;
    const mockFs = fs as jest.Mocked<typeof fs>;
    const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockOptions = new MSBuildOptions({
            toolsVersion: '15.0',
            windir: 'C:\\Windows' as any as any
        });
        
        // Default mock for Architecture
        Object.defineProperty(ArchitectureService, 'Architecture', {
            get: jest.fn(() => 'x64'),
            configurable: true
        });
    });

    describe('constructor', () => {
        it('should initialize with x64 architecture', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x64'),
                configurable: true
            });

            const finder = new MSBuildFinder(mockOptions);
            expect(finder).toBeDefined();
        });

        it('should initialize with x86 architecture', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x86'),
                configurable: true
            });

            const finder = new MSBuildFinder(mockOptions);
            expect(finder).toBeDefined();
        });

        it('should use default windir when not provided', () => {
            const options = new MSBuildOptions({
                toolsVersion: '15.0'
            });
            
            const finder = new MSBuildFinder(options);
            expect(finder).toBeDefined();
        });

        it('should default toolsVersion to auto when undefined', () => {
            const options = new MSBuildOptions({});
            options.toolsVersion = undefined;
            
            mockFs.existsSync.mockReturnValue(false);
            
            const finder = new MSBuildFinder(options);
            const result = finder.findVersion();
            
            // When auto mode and nothing found, should return null
            expect(result).toBeNull();
        });

        it('should use default windir C:\\Windows when undefined', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x64'),
                configurable: true
            });

            const options = new MSBuildOptions({
                toolsVersion: '4.0'
            });
            options.windir = undefined;
            
            const finder = new MSBuildFinder(options);
            const result = finder.concatPreV12('4.0');
            
            // The default in the constructor is 'C:\Windows' (with single backslash in the string literal)
            expect(result).toContain('Windows');
            expect(result).toContain('Framework64');
            expect(result).toContain('v4.0.30319');
        });
    });

    describe('findVersion', () => {
        it('should throw error for invalid version', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: 'invalid',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            expect(() => finder.findVersion()).toThrow('version unknown');
        });

        it('should return null when vswhere.exe does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).toBeNull();
        });

        it('should handle missing ProgramFiles(x86) environment variable', () => {
            const originalEnv = process.env['ProgramFiles(x86)'];
            delete process.env['ProgramFiles(x86)'];

            mockFs.existsSync.mockReturnValue(false);

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).toBeNull();

            // Restore
            if (originalEnv) {
                process.env['ProgramFiles(x86)'] = originalEnv;
            }
        });

        it('should find version using vswhere.exe', () => {
            const mockInstallations = [
                {
                    installationPath: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community',
                    installationVersion: '15.0.0.0'
                }
            ];

            mockFs.existsSync.mockReturnValue(true);
            mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(mockInstallations)));

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).not.toBeNull();
            expect(Array.isArray(result)).toBe(true);
        });

        it('should handle execSync errors gracefully', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockExecSync.mockImplementation(() => {
                throw new Error('Command failed');
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).toBeNull();
        });

        it('should find version for auto mode', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: 'auto' as any,
                windir: 'C:\\Windows' as any as any
            });

            mockFs.existsSync.mockReturnValue(false);

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).toBeNull();
        });

        it('should find pre-v12 version without requiring vswhere.exe', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '4.0',
                windir: 'C:\\Windows' as any
            });

            // existsSync returns true only for the .NET Framework path (no vswhere)
            mockFs.existsSync.mockImplementation((p: any) => {
                return String(p).includes('Framework');
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            // vswhere should NOT have been called for a pre-v12 version
            expect(mockExecSync).not.toHaveBeenCalled();
            expect(result).not.toBeNull();
            expect(result![0]).toContain('MSBuild.exe');
            expect(result![1]).toBe('4.0');
        });

        it('should return null when pre-v12 .NET Framework path does not exist', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '4.0',
                windir: 'C:\\Windows' as any
            });

            mockFs.existsSync.mockReturnValue(false);

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(mockExecSync).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        it('should find MSBuild 18.0 by matching installationVersion major number', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '18.0',
                windir: 'C:\\Windows' as any
            });

            // Simulate a VS 18 installation whose path may not contain '18' as a substring
            const mockInstallations = [
                {
                    installationPath: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
                    installationVersion: '17.8.0.0'
                },
                {
                    installationPath: 'C:\\Program Files\\Microsoft Visual Studio\\2026\\Community',
                    installationVersion: '18.0.0.0'
                }
            ];

            // vswhere.exe itself must also "exist" to allow the lookup to proceed
            mockFs.existsSync.mockImplementation((p: any) => {
                const s = String(p);
                return s.includes('vswhere') || s.includes('MSBuild');
            });
            mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(mockInstallations)));

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).not.toBeNull();
            expect(result![0]).toContain('2026');
            expect(result![0]).toContain('MSBuild.exe');
            expect(result![1]).toBe('18.0');
        });

        it('should return null path when no VS 18 installation is found', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '18.0',
                windir: 'C:\\Windows' as any
            });

            // Only VS 17 is installed
            const mockInstallations = [
                {
                    installationPath: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
                    installationVersion: '17.8.0.0'
                }
            ];

            mockFs.existsSync.mockReturnValue(true);
            mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(mockInstallations)));

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).not.toBeNull();
            expect(result![0]).toBeNull();
        });

        it('should find MSBuild 16.0 (VS 2019) by installationVersion', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '16.0',
                windir: 'C:\\Windows' as any
            });

            const mockInstallations = [
                {
                    installationPath: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community',
                    installationVersion: '16.11.5.0'
                }
            ];

            mockFs.existsSync.mockImplementation((p: any) => {
                const s = String(p);
                return s.includes('vswhere') || s.includes('MSBuild');
            });
            mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(mockInstallations)));

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).not.toBeNull();
            expect(result![0]).toContain('2019');
            expect(result![1]).toBe('16.0');
        });

        it('should find MSBuild 17.0 (VS 2022) by installationVersion', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '17.0',
                windir: 'C:\\Windows' as any
            });

            const mockInstallations = [
                {
                    installationPath: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
                    installationVersion: '17.8.0.0'
                }
            ];

            mockFs.existsSync.mockImplementation((p: any) => {
                const s = String(p);
                return s.includes('vswhere') || s.includes('MSBuild');
            });
            mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(mockInstallations)));

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.findVersion();

            expect(result).not.toBeNull();
            expect(result![0]).toContain('2022');
            expect(result![1]).toBe('17.0');
        });
    });

    describe('concatCorrectPath', () => {
        it('should handle version 16.0 and above', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '16.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatCorrectPath('C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community');

            expect(result).toContain('MSBuild');
            expect(result).toContain('Current');
        });

        it('should return empty string when installation path does not match version', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '16.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatCorrectPath('C:\\Invalid\\Path');

            expect(result).toBe('');
        });

        it('should handle version 15.0 and below', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '15.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatCorrectPath('C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community');

            expect(result).toContain('MSBuild');
            expect(result).toContain('15.0');
        });

        it('should handle version 12.0 to 14.0', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '12.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatCorrectPath('C:\\Program Files (x86)\\MSBuild');

            expect(result).toContain('MSBuild');
            expect(result).toContain('12.0');
        });

        it('should handle pre-v12 versions', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '4.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatCorrectPath('');

            expect(result).toContain('Microsoft.Net');
            expect(result).toContain('MSBuild.exe');
        });
    });

    describe('concatPreV12', () => {
        it('should build path for x64 architecture', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x64'),
                configurable: true
            });

            mockOptions = new MSBuildOptions({
                toolsVersion: '4.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatPreV12('4.0');

            expect(result).toContain('Framework64');
            expect(result).toContain('v4.0.30319');
        });

        it('should build path for x86 architecture', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x86'),
                configurable: true
            });

            mockOptions = new MSBuildOptions({
                toolsVersion: '4.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatPreV12('4.0');

            expect(result).toContain('Framework');
            expect(result).not.toContain('Framework64');
        });
    });

    describe('concatV15AndBelow', () => {
        it('should include amd64 for x64 builds', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x64'),
                configurable: true
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatV15AndBelow('C:\\VS2017', '15.0');

            expect(result).toContain('amd64');
        });

        it('should not include amd64 for x86 builds', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x86'),
                configurable: true
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatV15AndBelow('C:\\VS2017', '15.0');

            expect(result).not.toContain('amd64');
        });
    });

    describe('concatV16AndAbove', () => {
        it('should return empty string for non-matching installation path', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '16.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatV16AndAbove('C:\\Invalid\\Path', '16.0');

            expect(result).toBe('');
        });

        it('should return correct path for VS 2019', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '16.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatV16AndAbove('C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community', '16.0');

            expect(result).toContain('Current');
            expect(result).toContain('MSBuild.exe');
        });

        it('should return correct path for VS 2022', () => {
            mockOptions = new MSBuildOptions({
                toolsVersion: '17.0',
                windir: 'C:\\Windows' as any as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.concatV16AndAbove('C:\\Program Files\\Microsoft Visual Studio\\2022\\Community', '17.0');

            expect(result).toContain('Current');
        });
    });

    describe('getInstalledVersion', () => {
        it('should return first existing path', () => {
            mockFs.existsSync.mockImplementation((path) => {
                return path === 'C:\\existing\\path';
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getInstalledVersion(['C:\\nonexistent', 'C:\\existing\\path', 'C:\\another']);

            expect(result).toBe('C:\\existing\\path');
        });

        it('should return null when no paths exist', () => {
            mockFs.existsSync.mockReturnValue(false);

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getInstalledVersion(['C:\\path1', 'C:\\path2']);

            expect(result).toBeNull();
        });

        it('should skip empty paths', () => {
            mockFs.existsSync.mockImplementation((path) => {
                return path === 'C:\\valid';
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getInstalledVersion(['', 'C:\\valid']);

            expect(result).toBe('C:\\valid');
        });
    });

    describe('getx64_dir', () => {
        it('should return amd64 for x64 architecture', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x64'),
                configurable: true
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getx64_dir();

            expect(result).toBe('amd64');
        });

        it('should return empty string for x86 architecture', () => {
            Object.defineProperty(ArchitectureService, 'Architecture', {
                get: jest.fn(() => 'x86'),
                configurable: true
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getx64_dir();

            expect(result).toBe('');
        });
    });

    describe('getLatestAvailableVersion', () => {
        it('should return null when no versions are found', () => {
            mockFs.existsSync.mockReturnValue(false);
            
            mockOptions = new MSBuildOptions({
                toolsVersion: 'auto' as any,
                windir: 'C:\\Windows' as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getLatestAvailableVersion();

            expect(result).toBeNull();
        });

        it('should return latest version when multiple versions are found', () => {
            const mockInstallations = [
                {
                    installationPath: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community',
                    installationVersion: '16.11.5.0'
                }
            ];

            mockFs.existsSync.mockReturnValue(true);
            mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(mockInstallations)));

            mockOptions = new MSBuildOptions({
                toolsVersion: 'auto' as any,
                windir: 'C:\\Windows' as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getLatestAvailableVersion();

            expect(result).not.toBeNull();
            if (result) {
                expect(result[0]).toBeDefined();
                expect(result[1]).toBeDefined();
            }
        });

        it('should auto-detect MSBuild 18 when a VS 18 installation is present', () => {
            const mockInstallations = [
                {
                    installationPath: 'C:\\Program Files\\Microsoft Visual Studio\\2026\\Community',
                    installationVersion: '18.0.0.0'
                }
            ];

            mockFs.existsSync.mockImplementation((p: any) => {
                const s = String(p);
                return s.includes('vswhere') || s.includes('MSBuild');
            });
            mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(mockInstallations)));

            mockOptions = new MSBuildOptions({
                toolsVersion: 'auto' as any,
                windir: 'C:\\Windows' as any
            });

            const finder = new MSBuildFinder(mockOptions);
            const result = finder.getLatestAvailableVersion();

            expect(result).not.toBeNull();
            expect(result![1]).toBe('18.0');
            expect(result![0]).toContain('MSBuild.exe');
        });
    });
});
