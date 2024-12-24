const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ytdl = require('ytdl-core');
require('dotenv').config();
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});
// Listen for voice state updates (when users join/leave channels)
client.on('voiceStateUpdate', async (oldState, newState) => {
    const user = newState.member.user.username;

    // Check if a user has joined a voice channel
    if (!oldState.channelId && newState.channelId) {
        const channelName = newState.channel.name;
        const guild = newState.guild;

        // Send a message in the default text channel
        const textChannel = guild.channels.cache.find(
            (ch) => ch.type === 0 && ch.permissionsFor(guild.members.me).has('SendMessages')
        );

        if (textChannel) {
            textChannel.send(`🎉 **${user}** has joined the voice channel **${channelName}**!`);
        }

        // Announce in the voice channel
        try {
            const connection = joinVoiceChannel({
                channelId: newState.channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            // Generate a TTS announcement
            const ttsFilePath = `./welcome-${user}.mp3`;
            exec(
                `gtts-cli "Welcome ${user} to the voice channel ${channelName}" --output "${ttsFilePath}"`,
                (err) => {
                    if (err) {
                        console.error('Error generating TTS file:', err);
                        return;
                    }

                    console.log('TTS file generated successfully.');

                    // Play the TTS announcement
                    const resource = createAudioResource(fs.createReadStream(ttsFilePath));
                    const player = createAudioPlayer();
                    connection.subscribe(player);
                    player.play(resource);

                    // Cleanup after playing
                    player.on('idle', () => {
                        fs.unlink(ttsFilePath, (err) => {
                            if (err) console.error('Failed to delete TTS file:', err);
                        });
                        connection.destroy();
                    });

                    player.on('error', (error) => {
                        console.error('Error with player:', error);
                        connection.destroy();
                    });
                }
            );
        } catch (error) {
            console.error('Error joining voice channel or announcing:', error);
        }
    }
});
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command to play a local audio file
    if (command === 'play') {
        const fileName = args[0];
        if (!fileName) {
            return message.reply('Please provide the name of the audio file to play.');
        }

        const filePath = path.join(__dirname, 'music', fileName);

        if (!fs.existsSync(filePath)) {
            return message.reply('The specified file does not exist in the music folder.');
        }

        if (!message.member.voice.channel) {
            return message.reply('You need to be in a voice channel to play the audio!');
        }

        try {
            const connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            const resource = createAudioResource(fs.createReadStream(filePath));
            const player = createAudioPlayer();

            connection.subscribe(player);
            player.play(resource);

            player.on('error', (error) => {
                console.error('Error with player:', error);
                message.reply('An error occurred while trying to play the audio.');
            });

            console.log('Local audio is playing in the voice channel!');
            message.reply(`Now playing: ${fileName}`);
        } catch (error) {
            console.error('Error while playing local audio:', error);
            message.reply('An error occurred while trying to play the audio.');
        }
    }

    // Command to download a YouTube video as an MP3 file
    if (command === 'download') {
        const url = args[0];
        if (!ytdl.validateURL(url)) {
            return message.reply('Please provide a valid YouTube URL.');
        }

        const videoID = ytdl.getVideoID(url);
        const outputPath = path.join(__dirname, 'music', `${videoID}.mp3`);
        const tempFilePath = path.join(__dirname, 'music', `${videoID}_temp.mp4`);

        message.reply('Downloading the YouTube audio, please wait...');

        try {
            // Download the video
            const stream = ytdl(url, { filter: 'audioonly' });
            const writeStream = fs.createWriteStream(tempFilePath);

            stream.pipe(writeStream);

            writeStream.on('finish', () => {
                console.log('YouTube video downloaded successfully.');

                // Convert to MP3
                exec(
                    `ffmpeg -i "${tempFilePath}" -codec:a libmp3lame -b:a 192k "${outputPath}"`,
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error('Error converting the audio file:', stderr);
                            return message.reply('An error occurred while converting the audio file.');
                        }

                        console.log('Audio file converted successfully.');

                        // Delete temporary file
                        fs.unlink(tempFilePath, (err) => {
                            if (err) console.error('Error deleting temporary file:', err);
                        });

                        message.reply(`Download complete! File saved as: ${videoID}.mp3`);
                    }
                );
            });

            stream.on('error', (error) => {
                console.error('Error downloading YouTube audio:', error);
                message.reply('An error occurred while downloading the YouTube audio.');
            });
        } catch (error) {
            console.error('Error during the download process:', error);
            message.reply('An error occurred while downloading the YouTube audio.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
